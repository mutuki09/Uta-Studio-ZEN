/* phys/dsp-drum.js — 物理モデル音源の計算部（Rosewood drum）。録音素材は含まない。
   関数で包んでおき、AudioWorkletにはこの関数の文字列を渡し、オフライン書き出しでは直接呼ぶ。 */
(function (root) {
  root.physDsp = root.physDsp || {};
  root.physDsp.drum = function () {

/* Drum engine: modal synthesis. Membranes use the circular-membrane (Bessel) modes, cymbals a dense inharmonic
   mode set with quadratic coupling (low modes pump the high ones = the "wash"). Each mode is a complex one-pole
   resonator, so frequency and damping can change mid-note (pitch glide, hi-hat choke). Plain math, ports 1:1 to C++. */
const TAU=Math.PI*2;
function besselJ(m,x){let s=0;const N=64;for(let i=0;i<=N;i++){const t=Math.PI*i/N;s+=(i===0||i===N?.5:1)*Math.cos(m*t-x*Math.sin(t));}return s/N;}
const MEMB=[[0,2.405],[1,3.832],[2,5.136],[0,5.520],[3,6.380],[1,7.016],[4,7.588],[2,8.417],[0,8.654],[5,8.771],
  [3,9.761],[6,9.936],[1,10.173],[4,11.065],[7,11.086],[2,11.620],[0,11.792],[8,12.225],[5,12.339],[3,13.015]];
function rng(seed){let s=seed>>>0;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);}
class Biquad{constructor(){this.b0=1;this.b1=0;this.b2=0;this.a1=0;this.a2=0;this.x1=0;this.x2=0;this.y1=0;this.y2=0;}
  bp(f,q,sr){const w=TAU*f/sr,al=Math.sin(w)/(2*q),a0=1+al;this.b0=al/a0;this.b1=0;this.b2=-al/a0;this.a1=-2*Math.cos(w)/a0;this.a2=(1-al)/a0;return this;}
  hp(f,q,sr){const w=TAU*f/sr,al=Math.sin(w)/(2*q),c=Math.cos(w),a0=1+al;this.b0=(1+c)/2/a0;this.b1=-(1+c)/a0;this.b2=(1+c)/2/a0;this.a1=-2*c/a0;this.a2=(1-al)/a0;return this;}
  run(x){const y=this.b0*x+this.b1*this.x1+this.b2*this.x2-this.a1*this.y1-this.a2*this.y2;this.x2=this.x1;this.x1=x;this.y2=this.y1;this.y1=y;return y;}}
class Bank{
  constructor(n){this.n=n;const F=()=>new Float64Array(n);this.re=F();this.im=F();this.cr=F();this.ci=F();this.f0=F();this.t60=F();this.ex=F();this.nw=F();this.ow=F();this.m=new Int8Array(n);this.dm=1;this.sl=0;}
  set(k,f,t60,ow){this.f0[k]=f;this.t60[k]=t60;this.ow[k]=ow;}
  coefs(mult,sr){const dm=this.dm;for(let k=0;k<this.n;k++){const f=Math.min(this.f0[k]*mult,sr*.45),r=Math.pow(10,-3/(this.t60[k]*dm*sr)),w=TAU*f/sr;this.cr[k]=r*Math.cos(w);this.ci[k]=r*Math.sin(w);}}
  step(x,nl,nLow){let y=0,sl=0;const n=this.n,re=this.re,im=this.im,cr=this.cr,ci=this.ci,ex=this.ex,nw=this.nw,ow=this.ow;
    for(let k=0;k<n;k++){const a=re[k],b=im[k],c=cr[k],s=ci[k],nr=c*a-s*b+x*ex[k]+nl*nw[k];im[k]=c*b+s*a;re[k]=nr;y+=nr*ow[k];if(k<nLow)sl+=nr;}
    this.sl=sl;return y;}
  energy(){let e=0;for(let k=0;k<this.n;k++)e+=this.re[k]*this.re[k]+this.im[k]*this.im[k];return e;}
  clear(){this.re.fill(0);this.im.fill(0);}
}
/* a raised-cosine contact force: its length (stick/beater contact time) is what low-passes the strike */
class Pulse{constructor(){this.n=0;this.t=0;this.a=0;}
  hit(area,Tc,sr){this.n=Math.max(2,Math.round(Tc*sr));this.t=0;this.a=2*area/this.n;}
  next(){if(this.t>=this.n)return 0;const s=Math.sin(Math.PI*(this.t+.5)/this.n);this.t++;return this.a*s*s;}
  get busy(){return this.t<this.n;}}
class Drum{
  constructor(d,c){this.sr=d.sr;Object.assign(this,c);this.prm={tune:0,damp:c.damp0,x:c.x0};this.b=new Bank(22);this.pu=new Pulse();
    this.rim=new Bank(6);this.rp=new Pulse();this.ck=0;this.ckF=new Biquad().bp(c.clickF||3500,.9,this.sr);this.ckD=Math.pow(.001,1/(.005*this.sr));
    this.wenv=0;this.wf1=new Biquad().hp(1500,.7,this.sr);this.wf2=new Biquad().bp(3500,.6,this.sr);this.wrel=Math.pow(.001,1/(.11*this.sr));
    this.cnt=0;this.ac=0;this.on=false;this.lv=0;this.build();}
  build(){const p=this.prm,sr=this.sr,b=this.b,f0=this.base*Math.pow(2,p.tune/12);
    /* rad: how well each mode family reaches a distant (overhead) mic. Axisymmetric (m=0) modes push air as a
       monopole; m>=1 halves move in opposite directions and largely cancel. Measured toms sit ~28 dB down on m=1. */
    const rad=this.rad;
    for(let k=0;k<20;k++){const [m,j]=MEMB[k],ratio=Math.pow(j/2.405,this.gam),f=f0*ratio;
      const t60=this.T*(1-.85*p.damp)*Math.pow(1/ratio,this.dexp)*(k===0?this.fundT:1);
      /* higher axisymmetric modes have nodal circles, so their rings partly cancel too (rad[3]) */
      b.set(k,f,Math.max(.012,t60),(m===0?(k===0?rad[0]:rad[3]):m===1?rad[1]:rad[2])/(1+Math.pow(f/7000,2)));b.m[k]=m;}
    /* resonant (bottom) head: slightly detuned twins of the two lowest modes, driven through the air column */
    b.set(20,f0*1.012,this.T*1.2*(1-.6*p.damp),.45);b.set(21,f0*Math.pow(3.832/2.405,this.gam)*1.02,this.T*.8*(1-.7*p.damp),.25);
    b.coefs(1,sr);
    const R=this.rimModes||[[480,.07],[910,.06],[1720,.05],[2650,.04],[3900,.03],[5600,.025]];
    R.forEach(([f,t],k)=>{this.rim.set(k,f,t,1);this.rim.ex[k]=k%2?-1:1;});this.rim.coefs(1,sr);}
  glideAmt(){return this.tom?this.prm.x*this.glideK:this.glide;}
  strike(e){const vel=e.vel,art=e.art||'center';let r=e.pos==null?.3:e.pos,hv=vel;
    if(art==='rim'){r=.93;hv=vel*1.8;this.rp.hit(vel*3,.00025,this.sr);}/* stick lands on head and hoop at once */
    else if(art==='side'){r=.86;hv=vel*.14;this.rp.hit(vel*1,.0004,this.sr);}
    r=Math.min(.97,Math.max(0,r));
    for(let k=0;k<20;k++){const [m,j]=MEMB[k];this.b.ex[k]=besselJ(m,j*r);}
    this.b.ex[20]=.4*this.b.ex[0];this.b.ex[21]=.3*this.b.ex[1];
    const Tc=this.kick?(.0055*(1-this.prm.x)+.0009*this.prm.x)/(.6+.6*vel):.0011/(.5+.8*vel);
    this.pu.hit(hv,Tc,this.sr);
    this.ck=Math.max(this.ck,this.kick?vel*(.08+.5*this.prm.x):vel*.05);
    this.on=true;}
  render(){const sr=this.sr;let x=this.pu.next();
    const ga=this.glideAmt();
    if(ga>0&&(this.cnt++&15)===0){const A=Math.hypot(this.b.re[0],this.b.im[0]);this.b.coefs(1+ga*A/(1+A),sr);}
    let y=this.b.step(x,0,0);
    if(this.snare){/* wires sit on the bottom head and rattle once its excursion beats their tension */
      const yb=this.b.re[0]+.5*this.b.re[3]+.3*this.b.re[8],dr=Math.max(0,Math.abs(yb)-.02)*this.prm.x*1.4;
      this.wenv=Math.max(dr,this.wenv*this.wrel);if(this.wenv>1e-6)y+=this.wf2.run(this.wf1.run(Math.random()*2-1))*this.wenv;}
    const xr=this.rp.next();if(xr||this.rimOn){this.rimOn=true;y+=this.rim.step(xr,0,0)*.7;}
    if(this.ck>1e-5){y+=this.ckF.run(Math.random()*2-1)*this.ck;this.ck*=this.ckD;}
    if(((this.ac=(this.ac+1)&255))===0&&!this.pu.busy&&this.b.energy()<1e-11&&this.wenv<1e-6&&this.ck<1e-5){
      if(!this.rimOn||this.rim.energy()<1e-11){this.on=false;this.rimOn=false;this.b.clear();this.rim.clear();}}
    return y*this.gain;}
}
/* Cymbal mode layout follows plate physics: a thin plate's modal density is roughly constant per Hz, so most
   modes sit high. A sparse log-spaced set covers the low "body" (below fSplit), then modes fill fSplit..fhi
   linearly. Each octave's excitation follows a level table measured from a real overhead recording (bandDb at
   250..16k), divided by sqrt(modes in that octave) so density does not skew it. Decay peaks around fPk (mid/high
   ring longest, as measured) and falls on both sides. */
const OCT=[250,500,1000,2000,4000,8000,16000];
function octDb(tab,f){const x=Math.log2(f/250);if(x<=0)return tab[0];if(x>=6)return tab[6];const i=Math.floor(x),u=x-i;return tab[i]*(1-u)+tab[i+1]*u;}
class Cym{
  constructor(d,c){this.sr=d.sr;Object.assign(this,c);this.prm={tune:0,damp:c.damp0,x:c.x0};const R=rng(c.seed),N=c.N,bf=c.bellF||[],nb=bf.length;
    this.nb=nb;this.b=new Bank(N+nb);this.pu=new Pulse();this.fz=[];this.exr=[];this.owr=[];
    const nLog=Math.round(N*.3);
    for(let k=0;k<N;k++){const f=k<nLog?this.flo*Math.pow(c.fSplit/this.flo,(k+R()*.9)/nLog):c.fSplit+(this.fhi-c.fSplit)*(k-nLog+R())/(N-nLog);
      this.fz.push(f);this.exr.push((.6+.8*R())*(R()<.5?-1:1));this.owr.push(.7+.3*R());this.b.nw[k]=f>2000?(R()-.5)*.03:0;}
    /* density compensation: count modes within half an octave */
    this.dens=this.fz.map(f=>this.fz.filter(g=>g>f/1.414&&g<f*1.414).length);
    this.o=c.hat?0:1;this.choke=false;this.sz=new Biquad().hp(6000,.7,this.sr);this.ac=0;this.on=false;this.lv=0;this.build();}
  build(){const p=this.prm,b=this.b,t=Math.pow(2,p.tune/12),N=this.N,T=this.T*(1-.85*p.damp);
    for(let k=0;k<N;k++){const f=this.fz[k]*t,g=f<this.fPk?Math.pow(f/this.fPk,.5):Math.pow(this.fPk/f,.45);
      b.set(k,f,Math.max(.03,T*g),this.owr[k]);}
    for(let i=0;i<this.nb;i++)b.set(N+i,this.bellF[i]*t,this.bellT[i]*(1-.6*p.damp),1);
    this.applyDamp();}
  applyDamp(){this.b.dm=this.hat?.1+.9*Math.pow(this.o,1.4):this.choke?.012:1;this.b.coefs(1,this.sr);}
  strike(e){const vel=e.vel,art=e.art||'hit',N=this.N;let r=e.pos==null?.6:e.pos,a=vel;
    if(this.hat){if(art==='pedal'){this.o=0;this.applyDamp();a=vel*1.6;r=.5;}
      else{const no=art==='open'?this.prm.x:0;if(no!==this.o){this.o=no;this.applyDamp();}}}
    if(this.choke){this.choke=false;this.applyDamp();}
    const bell=this.nb>0&&(art==='bell'||r<.25),t=Math.pow(2,this.prm.tune/12);
    /* edge hits drive the low body modes harder; bell hits mostly ring the bell partials */
    for(let k=0;k<N;k++){const f=this.fz[k]*t,lowBoost=f<1500?.4+.9*r:1;
      this.b.ex[k]=this.exr[k]*Math.pow(10,octDb(this.bandDb,f)/20)/Math.sqrt(this.dens[k])*lowBoost*(bell?.25:1);}
    for(let i=0;i<this.nb;i++)this.b.ex[N+i]=(bell?this.bellA[i]:.04)*(i%2?-1:1);
    /* stick tip on bronze: contact well under 0.1 ms, so the force pulse barely filters the top octave */
    this.pu.hit(a,(art==='pedal'?.00008:.00004)/(.3+.7*vel),this.sr);this.on=true;}
  chokeIt(){if(this.hat){this.o=0;}else this.choke=true;this.applyDamp();}
  render(){const x=this.pu.next(),nl=this.kap*this.prm.x*this.b.sl*this.b.sl;
    let y=this.b.step(x,nl,this.nLow);
    if(this.hat&&this.o>.04&&this.o<.75)y+=this.sz.run(Math.random()*2-1)*Math.abs(y)*3*this.o*(1-this.o);/* loose plates rattling */
    if(((this.ac=(this.ac+1)&255))===0&&!this.pu.busy&&this.b.energy()<1e-11){this.on=false;this.b.clear();}
    return y*this.gain;}
}
/* Numbers marked (ref) come from measuring the Salamander Drumkit overhead recordings (A. Holm, CC BY-SA 3.0):
   18" kick 42 Hz T60 0.67 s gliding 50→41 Hz; 12" tom 137 Hz T60 2.0 s; 14" floor 65 Hz T60 3.0 s gliding 77→63 Hz;
   snare 200 Hz with its fundamental dying first (0.37 s) and upper partials ringing ~1 s; cymbal octave levels. */
const KIT=[
  {id:'kick',kick:true,base:40,T:1.0,gam:1.25,dexp:.4,fundT:1,rad:[1,.25,.05,1],glide:.8,damp0:.4,x0:.5,gain:.7,pan:0,clickF:3200},
  {id:'snare',snare:true,base:200,T:.9,gam:.92,dexp:.1,fundT:.55,rad:[1,.2,.15,.5],glide:.1,damp0:.3,x0:.6,gain:.6,pan:-.12,
    rimModes:[[1129,.25],[1054,.2],[916,.18],[1589,.15],[2961,.1],[431,.3]]},
  {id:'tomH',tom:true,base:132,T:2.6,gam:.93,dexp:.3,fundT:1,rad:[1,.12,.06,.2],glideK:.6,damp0:.3,x0:.5,gain:.55,pan:-.22},
  {id:'tomM',tom:true,base:100,T:3.0,gam:.93,dexp:.3,fundT:1,rad:[1,.12,.06,.2],glideK:1.1,damp0:.3,x0:.5,gain:.55,pan:.12},
  {id:'floor',tom:true,base:54,T:3.8,gam:.93,dexp:.3,fundT:1,rad:[1,.12,.06,.2],glideK:2,damp0:.3,x0:.5,gain:.6,pan:.5},
  /* bandDb = octave levels 250..16k Hz (ref) */
  {id:'hat',cym:true,hat:true,N:110,flo:420,fSplit:2500,fhi:17000,fPk:1000,T:6.5,nLow:20,seed:3,damp0:.2,x0:.85,gain:.5,pan:-.5,kap:.15,
    bandDb:[-30,-24,-22,-16,-10,-4,0]},
  {id:'crash',cym:true,N:150,flo:300,fSplit:2500,fhi:17000,fPk:4000,T:6.5,nLow:30,seed:7,damp0:.15,x0:.5,gain:.5,pan:-.62,kap:.25,
    bandDb:[-18,0,-9,-8,-4,-6,-17]},
  {id:'ride',cym:true,N:150,flo:330,fSplit:2500,fhi:17000,fPk:4500,T:3.8,nLow:30,seed:11,damp0:.15,x0:.25,gain:.5,pan:.62,kap:.25,
    bandDb:[-22,-15,-16,-16,-10,0,-1],bellF:[634,1687,3367,4250,2024,470],bellT:[1.6,1.4,1.2,1.0,1.2,1.8],bellA:[.7,.85,.65,.55,.35,.35]}];
class DrumDSP{
  constructor(sr){this.sr=sr;this.width=.8;this.list=KIT.map(c=>c.cym?new Cym(this,c):new Drum(this,c));this.by={};this.list.forEach(p=>this.by[p.id]=p);
    this.q=[];this.pan();this.shp=new Float32Array(this.list.length*10);}
  pan(){this.list.forEach(p=>{const th=(p.pan*this.width+1)*Math.PI/4;p.gl=Math.cos(th);p.gr=Math.sin(th);});}
  handle(m){
    if(m.type==='ev'){for(const e of m.list){e.f=e.t?Math.round(e.t*this.sr):0;let i=this.q.length;while(i>0&&this.q[i-1].f>e.f)i--;this.q.splice(i,0,e);}}
    else if(m.type==='prm'){const p=this.by[m.id];if(p){Object.assign(p.prm,m.prm);p.build();}}
    else if(m.type==='width'){this.width=m.v;this.pan();}
    else if(m.type==='clear'){this.q.length=0;}}
  apply(e){const p=this.by[e.p];if(!p)return;if(e.kind==='choke'){p.chokeIt&&p.chokeIt();}else p.strike(e);}
  render(L,R,n,start){const ls=this.list,np=ls.length;
    for(let i=0;i<n;i++){const frame=start+i;
      while(this.q.length&&this.q[0].f<=frame)this.apply(this.q.shift());
      let l=0,r=0;
      for(let k=0;k<np;k++){const p=ls[k];if(!p.on)continue;const y=p.render(),a=y<0?-y:y;if(a>p.lv)p.lv=a;l+=y*p.gl;r+=y*p.gr;}
      L[i]=l*.5;R[i]=r*.5;}}
  snap(){const sh=this.shp;this.list.forEach((p,i)=>{for(let k=0;k<10;k++)sh[i*10+k]=p.cym?0:p.b.re[k];});
    const out={modes:sh.slice(),lv:this.list.map(p=>p.lv),hat:this.by.hat.o};this.list.forEach(p=>p.lv*=.6);return out;}
}

  return DrumDSP;
  };
})(typeof window !== "undefined" ? (window.US = window.US || {}) : (module.exports = {}));
