/* phys/dsp-keys.js — 物理モデル音源の計算部（Rosewood keys）。録音素材は含まない。
   関数で包んでおき、AudioWorkletにはこの関数の文字列を渡し、オフライン書き出しでは直接呼ぶ。 */
(function (root) {
  root.physDsp = root.physDsp || {};
  root.physDsp.keys = function () {

/* Keys engine. Piano: hammer force pulse into stiff-string partials (f_n = n f1 sqrt(1+B n^2)), unison pairs with
   two-stage decay, strike point at ~1/8 of the string, dampers. Electric piano: tine/reed modal model read through a
   nonlinear magnetic (or electrostatic) pickup. Synth: PolyBLEP oscillators into a saturating 4-pole ladder filter. */
const TAU=Math.PI*2,mtof=m=>440*Math.pow(2,(m-69)/12);
function rng(seed){let s=seed>>>0||1;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);}
const ftanh=x=>x<-3?-1:x>3?1:x*(27+x*x)/(27+9*x*x);
class Bank{constructor(n){this.n=n;const F=()=>new Float64Array(n);this.re=F();this.im=F();this.cr=F();this.ci=F();this.f=F();this.t=F();this.ex=F();this.ow=F();}
  set(k,f,t60,ow,ex){this.f[k]=f;this.t[k]=t60;this.ow[k]=ow;this.ex[k]=ex;}
  coefs(sr,tmax){for(let k=0;k<this.n;k++){const t=Math.min(this.t[k],tmax),r=Math.pow(10,-3/(Math.max(.005,t)*sr)),w=TAU*Math.min(this.f[k],sr*.45)/sr;this.cr[k]=r*Math.cos(w);this.ci[k]=r*Math.sin(w);}}
  step(x){let y=0;const n=this.n,re=this.re,im=this.im,cr=this.cr,ci=this.ci,ex=this.ex,ow=this.ow;
    for(let k=0;k<n;k++){const a=re[k],b=im[k],nr=cr[k]*a-ci[k]*b+x*ex[k];im[k]=cr[k]*b+ci[k]*a;re[k]=nr;y+=nr*ow[k];}return y;}
  energy(){let e=0;for(let k=0;k<this.n;k++)e+=this.re[k]*this.re[k]+this.im[k]*this.im[k];return e;}}
/* skewed contact pulse: felt compresses fast and releases slower, area = momentum handed to the string */
class Hit{constructor(){this.w=null;this.i=0;}
  make(Tc,area,sr,a=1.5,b=2.6){const n=Math.max(2,Math.round(Tc*sr)),w=new Float64Array(n);let s=0;for(let i=0;i<n;i++){const u=(i+.5)/n;w[i]=Math.pow(u,a)*Math.pow(1-u,b);s+=w[i];}
    for(let i=0;i<n;i++)w[i]*=area/s;this.w=w;this.i=0;}
  use(w,area){let s=0;for(const v of w)s+=v;const k=s>0?area/s:0;this.w=w.map(v=>v*k);this.i=0;}
  next(){return this.w&&this.i<this.w.length?this.w[this.i++]:0;}
  get busy(){return !!this.w&&this.i<this.w.length;}}
/* Piano hammer–string collision, integrated in physical units at 4x the sample rate.
   Felt: F = K c^p (c = felt compression). The struck string yields with velocity F/(2Z); the pulses it launches
   come back inverted from the agraffe (t1) and the bridge (t2) and push on the hammer again — that is what gives
   real hammer forces their ripples and makes loud notes brighter. Register scaling follows typical grand data:
   speaking length, 1–3 strings at ~750 N each, hammer 11 g (bass) to 6 g (treble), felt harder and more nonlinear upward. */
function hammerForce(m,f1,vel,hard,xs,sr){
  const L=Math.min(1.9,.62*Math.pow(2,-(m-60)*.075)),c=2*L*f1,nS=m<30?1:m<40?2:3,Z=nS*750/c;
  /* two-layer felt: soft outer felt (exponent p) over a hard pressed core that only engages at deep compression
     (exponent p+2.5) — so pp stays round and ff gets a sharp force peak, as measured on real hammers */
  const u=(m-21)/87,mh=(11-6.5*u)*1e-3,p=2.3+.5*u,K0=Math.pow(10,1.75+1.1*u)*(.45+1.1*hard),core=.35,v0=.3+4.7*Math.pow(vel,1.4);
  const os=4,dt=1/(sr*os),d1=Math.max(1,Math.round(2*xs*L/c/dt)),d2=Math.max(1,Math.round(2*(1-xs)*L/c/dt)),nMax=Math.round(.025/dt);
  const F=new Float64Array(nMax);let xh=0,vh=v0,ys=0,n=0,started=false;
  for(;n<nMax;n++){const cmp=(xh-ys)*1000,f=cmp>0?K0*(Math.pow(cmp,p)+core*Math.pow(cmp,p+2.5)):0;F[n]=f;if(f>0)started=true;else if(started&&vh<0)break;
    vh-=f/mh*dt;xh+=vh*dt;
    const back=(n>=d1?F[n-d1]:0)+(n>=d2?F[n-d2]:0)-(n>=d1+d2?F[n-d1-d2]:0);ys+=(f-back)/(2*Z)*dt;}
  const out=new Float64Array(Math.max(2,Math.ceil(n/os)));for(let i=0;i<n;i++)out[Math.floor(i/os)]+=F[i]/os;return out;}
/* Voicing table: per-partial level corrections (dB, partials 1..12) that bring the physical model onto a measured
   Steinway B (University of Iowa MIS recordings, C2/C4/C6 at pp/mf/ff). The hammer physics alone gets the
   register trend right but not felt hysteresis, so loud/soft colour comes from here. Interpolated in note and velocity. */
const VOICE={notes:[36,60,84],vels:[.25,.6,1],db:[
  [[0,6,12,15,16,16,15,12,10,10,12,12],[0,6,12,17,19,19,18,15,12,12,15,17],[0,4,10,16,19,20,19,16,13,12,16,18]],
  [[0,-20,-20,-18,-24,-22,-20,-15,-15,-17,-17,-17],[0,-10,-6,-9,-9,-7,-5,-5,-10,-14,-16,-18],[0,-6,-7,-6,-2,-2,2,4,4,4,0,-3]],
  [[0,-2,-1,0,0,0,0,0,0,0,0,0],[0,-9,-15,-15,-15,-15,-15,-15,-15,-15,-15,-15],[0,-10,-17,-17,-17,-17,-17,-17,-17,-17,-17,-17]]]};
function voiceDb(m,vel,n){const N=VOICE.notes,V=VOICE.vels,i=Math.min(11,n-1);
  const ni=m<=N[0]?0:m>=N[2]?1.999:(m<N[1]?(m-N[0])/(N[1]-N[0]):1+(m-N[1])/(N[2]-N[1])),vi=vel<=V[0]?0:vel>=V[2]?1.999:(vel<V[1]?(vel-V[0])/(V[1]-V[0]):1+(vel-V[1])/(V[2]-V[1]));
  const a=Math.floor(ni),b=Math.floor(vi),u=ni-a,w=vi-b,g=(x,y)=>VOICE.db[x][y][i];
  return (g(a,b)*(1-w)+g(a,b+1)*w)*(1-u)+(g(a+1,b)*(1-w)+g(a+1,b+1)*w)*u;}
class PianoV{
  constructor(E,note){this.E=E;this.sr=E.sr;this.note=note;this.type='piano';this.hit=new Hit();this.down=true;this.damped=false;this.R=rng(note*7919+13);
    /* voicing: a technician evens the scale out by ear; here a measured gain curve does it (bass ~27 dB hotter raw) */
    const LV=[-11,-9,-9,-6,-3,2,4.5,4,3,3,3,5,8,7,8],li=Math.min(13.999,Math.max(0,(note-21)/6)),lf=Math.floor(li),lc=LV[lf]*(1+lf-li)+LV[lf+1]*(li-lf);
    this.lvl=.12*Math.pow(2,(note-21)/12*.72)*(1+Math.max(0,note-78)/8)*Math.pow(10,lc/20);/* + measured mf loudness sweep, A0..C8 */
    this.kn=0;this.knl=0;this.ac=0;this.build();const pan=(note-64)/44*.6;this.gl=Math.cos((pan+1)*Math.PI/4);this.gr=Math.sin((pan+1)*Math.PI/4);}
  build(){const p=this.E.p,m=this.note,sr=this.sr;
    /* Railsback-style stretch: bass a little flat, treble sharp (cents) */
    const cents=p.stretch*(m>60?Math.pow((m-60)/28,2)*14:-Math.pow((60-m)/39,2)*18),f1=mtof(m)*Math.pow(2,cents/1200);
    /* inharmonicity coefficient: smallest around C3, rising toward both ends (wound bass, short stiff treble) */
    const B=Math.pow(10,m<48?-3.6-(m-21)/27*.4:-4+(m-48)/48*2.1)*p.inharm;
    /* decay: measured C2 holds its prompt sound ~3x longer than C4; the aftersound (second unison mode) rings for many seconds */
    const N=Math.max(3,Math.min(80,Math.floor(16000/f1))),xs=1/(8+this.R()*.6),T1=p.sustain*20*Math.pow(2,-(m-21)/13),det=p.unison*(.35+.9*this.R())/1200;
    const L=[];this.f1=f1;this.B=B;this.xs=xs;
    /* radiation: the soundboard pushes air poorly at low frequency (+6 dB/oct up to ~350 Hz), so bass fundamentals are weak
       and the ear hears the pitch from the upper partials; its mobility falls off again in the top octaves */
    const rad=f=>(f/350)/Math.sqrt(1+(f/350)*(f/350))/(1+Math.pow(f/7500,2));
    /* the bass prompt sound decays far slower (measured C2: −20 dB after ~2.7 s vs ~0.7 s at C4) */
    const Afac=.5+1.1*Math.min(1,Math.max(0,(60-m)/24));
    /* prune partials the hardest possible blow cannot make audible (force spectrum x node x radiation < -70 dB) */
    const Fff=hammerForce(m,f1,1,p.hard,xs,sr);let A0=0;for(const v of Fff)A0+=v;
    const spec=f=>{let re=0,im=0;const w=TAU*f/sr;for(let i=0;i<Fff.length;i++){re+=Fff[i]*Math.cos(w*i);im-=Fff[i]*Math.sin(w*i);}return Math.hypot(re,im)/A0;};
    for(let n=1;n<=N;n++){const fn=n*f1*Math.sqrt(1+B*n*n);if(fn>sr*.45)break;const Tn=T1*Math.pow(f1/fn,.35),ex=Math.sin(n*Math.PI*xs),r=rad(fn);
      if(n>3&&spec(fn)*Math.abs(ex)*r<3e-5)continue;
      /* prompt sound (mode A) falls ~20 dB in the first second at C4; the aftersound (mode B) sits ~20 dB below and rings on */
      L.push([fn*(1-det/2),Tn*Afac,.8*r,ex,n]);if(n<=14)L.push([fn*(1+det/2),Tn*7,.08*r,ex,n]);}
    this.b=new Bank(L.length);this.ex0=new Float64Array(L.length);this.pn=new Int16Array(L.length);
    L.forEach((v,k)=>{this.b.set(k,v[0],v[1],v[2],v[3]);this.ex0[k]=v[3];this.pn[k]=v[4];});this.b.coefs(sr,1e9);this.nPart=Math.min(24,N);}
  strike(vel){const p=this.E.p,m=this.note;
    const F=hammerForce(m,this.f1,vel,p.hard,this.xs,this.sr);this.lastF=F;
    for(let k=0;k<this.b.n;k++)this.b.ex[k]=this.ex0[k]*Math.pow(10,voiceDb(m,vel,this.pn[k])/20);
    /* measured pp→ff span is ~21–28 dB */
    this.hit.use(F,(.03+.97*Math.pow(vel,2.3))*.9);
    if(this.damped){this.damped=false;this.b.coefs(this.sr,1e9);}this.down=true;this.kn=Math.max(this.kn,.02*vel);}
  release(){this.down=false;this.damper();}
  damper(){if(this.down||this.E.pedal||this.note>=89||this.damped)return;this.damped=true;this.b.coefs(this.sr,.1+.6*Math.pow(2,-(this.note-21)/12));this.kn=Math.max(this.kn,.004);}
  render(){let y=this.b.step(this.hit.next());
    if(this.kn>1e-6){this.knl+=(Math.random()*2-1-this.knl)*.015;y+=this.knl*this.kn*3;this.kn*=.9992;}/* key/hammer-rail thump */
    return y*this.lvl;}
  dead(){return(((this.ac=(this.ac+1)&255))===0)&&!this.hit.busy&&this.kn<1e-6&&this.b.energy()<1e-11;}
  viz(){const o=[];for(let n=0;n<this.nPart;n++){const k=n<14?2*n:14+n;if(k>=this.b.n)break;let a=Math.hypot(this.b.re[k],this.b.im[k])*this.b.ow[k];if(n<14)a+=Math.hypot(this.b.re[k+1],this.b.im[k+1])*this.b.ow[k+1];o.push([this.b.f[k],a]);}
    return {f1:this.f1,B:this.B,p:o,F:this.lastF?Array.from(this.lastF):null,sr:this.sr};}
}
class EPV{
  constructor(E,note){this.E=E;this.sr=E.sr;this.note=note;this.type='ep';this.hit=new Hit();this.down=true;this.damped=false;this.xp=0;this.ac=0;this.kn=0;this.knl=0;
    this.hist=new Float32Array(256);this.hi=0;this.hc=0;this.build();
    /* voicing: measured mf loudness sweep (E1..E7, every 8 keys) flattened to one level, as a technician sets the pickups */
    const LV=[-6.6,-5,-3.2,-1.2,.8,3.1,10,22.9,33.1,44],li=Math.min(8.999,Math.max(0,(note-28)/8)),lf=Math.floor(li);
    this.lvl=Math.pow(10,(LV[lf]*(1+lf-li)+LV[lf+1]*(li-lf))/20);
    const pan=(note-64)/40*.3;this.gl=Math.cos((pan+1)*Math.PI/4);this.gr=Math.sin((pan+1)*Math.PI/4);}
  build(){const p=this.E.p,m=this.note,f0=mtof(m),hd=p.hard;this.f0=f0;this.wurli=p.epType==='wurli';
    /* sustain measured on a 1977 Mk I (jRhodes3d): −20 dB after ~6–11 s at A2, ~4–6 s at D4, ~2–3 s at A5 */
    const T1=p.sustain*28*Math.pow(2,-(m-45)/20)*(this.wurli?.45:1);
    /* tine 2nd mode: a bare clamped-free beam would sit at 6.27x, but the tuning spring's mass pulls it down —
       measured 4.1x (low) to 5.5x (high). The reed has no spring, so it keeps the beam ratios */
    const r2=this.wurli?6.27:4.2+Math.min(1,Math.max(0,(m-45)/36))*1.3;
    const L=this.wurli?[[f0,T1,1,1],[f0*r2,.22,.5,.25+.35*hd],[f0*17.55,.05,.3,.08+.15*hd]]
      :[[f0,T1,1,1],[f0*1.0011,T1*1.7,.4,.45],[f0*r2,.25,.35,.12+.45*hd],[f0*17.55,.06,.2,.04+.18*hd]];
    this.b=new Bank(L.length);this.ex0=L.map(v=>v[3]);L.forEach((v,k)=>this.b.set(k,...v));this.b.coefs(this.sr,1e9);}
  strike(vel){const p=this.E.p;
    /* the bell partial grows steeply with blow strength (measured +10 dB re fundamental at ff, −44 dB at pp on A2) */
    const m=this.note,up=Math.min(1,Math.max(0,(m-62)/19));
    /* ...and fades out toward the treble (measured A5: −65 dB at mf) */
    const bv=8*Math.pow(vel,2.5)*Math.pow(10,-Math.max(0,m-62)/19);for(let k=0;k<this.b.n;k++)this.b.ex[k]=this.ex0[k]*(k>=(this.wurli?1:2)?bv:1);
    /* tine excursion spans ~30 dB pp→ff, so soft notes stay in the pickup's linear zone and hard ones bark.
       Long bass tines swing wider (more bark at mf); short treble tines have a narrower dynamic span */
    const lo=.05+.25*up,reg=1+Math.max(0,62-m)/17*.6;
    this.hit.make((.0026*(1-p.hard)+.0006)*(1.3-.5*vel)*(m<60?1.2:1),(lo+(1-lo)*vel*vel)*1.6*reg,this.sr);
    if(this.damped){this.damped=false;this.b.coefs(this.sr,1e9);}this.down=true;}
  release(){this.down=false;this.damper();}
  damper(){if(this.down||this.E.pedal||this.damped)return;this.damped=true;this.b.coefs(this.sr,.07);this.kn=.0025;}
  render(){const p=this.E.p,x=this.b.step(this.hit.next())*p.epAmp,v=x-this.xp;this.xp=x;let y;
    if(this.wurli){/* electrostatic reed pickup: capacitance ~ 1/gap, so the swing toward the plate is louder (even harmonics, growl) */
      const g=1/Math.pow(1+1.3*p.bark*Math.max(-.6,x),2);y=v*g;}
    else{/* magnetic pickup: flux through the coil ~ 1/(d^2+h^2); output = velocity x d(flux)/dx. The tine's offset (bark) skews it */
      const x0=.25+.9*p.bark,d=x-x0,h2=.5,g=-2*d/Math.pow(d*d+h2,2),g0=2*x0/Math.pow(x0*x0+h2,2);y=v*g/g0;}
    y*=this.sr/(TAU*this.f0)*.15;
    if(this.kn>1e-6){this.knl+=(Math.random()*2-1-this.knl)*.02;y+=this.knl*this.kn*3;this.kn*=.9985;}
    if(((this.hc=(this.hc+1)&3))===0){this.hist[this.hi]=x;this.hi=(this.hi+1)&255;}
    return y*this.lvl;}
  dead(){return(((this.ac=(this.ac+1)&255))===0)&&!this.hit.busy&&this.kn<1e-6&&this.b.energy()<1e-12;}
  viz(){return {hist:this.hist,hi:this.hi,bark:this.E.p.bark,wurli:this.wurli};}
}
function blep(t,dt){if(t<dt){t/=dt;return t+t-t*t-1;}if(t>1-dt){t=(t-1)/dt;return t*t+t+t+1;}return 0;}
class SynV{
  constructor(E,note,vel){this.E=E;this.sr=E.sr;this.note=note;this.type='synth';this.vel=vel;this.f=mtof(note);this.ft=this.f;
    /* unison: U copies of each oscillator, detuned symmetrically (slightly more at the edges, supersaw-style) and fanned across the stereo field */
    const U=Math.max(1,Math.min(9,Math.round(E.p.uni||1)));this.U=U;this.ph1=new Float64Array(U);this.ph2=new Float64Array(U);this.det=new Float64Array(U);this.pn=new Float64Array(U);
    for(let u=0;u<U;u++){this.ph1[u]=Math.random();this.ph2[u]=Math.random();const x=U>1?(u-(U-1)/2)/((U-1)/2):0;this.det[u]=Math.sign(x)*Math.pow(Math.abs(x),1.3);this.pn[u]=x;}
    this.phm=0;this.ps=0;this.s=[0,0,0,0];this.s2=[0,0,0,0];this.sv=[0,0];this.sv2=[0,0];
    this.ae=0;this.fe=0;this.stage='a';this.fstage='a';this.down=true;this.fc=1000;this.g=.1;this.ac=0;this.vib=1;this.k=2;this.a1=1;this.a2=0;this.a3=0;
    this.mod(0,E.lfo);}/* modulators run every 16 samples; a note can start between those ticks, so prime them now */
  retrig(note,vel,legato){this.note=note;this.ft=mtof(note);if(!legato||this.E.p.glide<=0){this.vel=vel;this.stage='a';this.fstage='a';}if(this.E.p.glide<=0)this.f=this.ft;this.down=true;}
  release(){this.down=false;this.stage='r';this.fstage='r';}
  osc(ph,dt,w){switch(w){case 'saw':return 2*ph-1-blep(ph,dt);
    case 'square':{let v=ph<.5?1:-1;v+=blep(ph,dt);v-=blep((ph+.5)%1,dt);return v;}
    case 'tri':return 1-4*Math.abs(ph-.5);default:return Math.sin(TAU*ph);}}
  mod(k,lfo){const p=this.E.p,sr=this.sr,a=x=>Math.exp(-1/(Math.max(.0008,x)*sr/k*.25));
    /* envelopes advanced every k samples: linear attack, exponential decay/release toward targets */
    if(this.stage==='a'){this.ae+=k/(Math.max(.001,p.aA)*sr);if(this.ae>=1){this.ae=1;this.stage='d';}}
    else if(this.stage==='d'){const c=a(p.aD);this.ae=p.aS+(this.ae-p.aS)*c;}
    else if(this.stage==='r'){const c=a(p.aR);this.ae*=c;}
    if(this.fstage==='a'){this.fe+=k/(Math.max(.001,p.fA)*sr);if(this.fe>=1){this.fe=1;this.fstage='d';}}
    else if(this.fstage==='d'){const c=a(p.fD);this.fe=p.fS+(this.fe-p.fS)*c;}
    else{const c=a(p.fR);this.fe*=c;}
    if(this.f!==this.ft){const c=p.glide>0?Math.exp(-k/(p.glide*sr)):0;this.f=this.ft+(this.f-this.ft)*c;if(Math.abs(this.f-this.ft)<.01)this.f=this.ft;}
    const oct=p.envAmt*6*this.fe*(.5+.5*this.vel)+lfo*p.lfoFilt*2+(this.note-60)/12*p.keyTrack;
    this.fc=Math.min(sr*.42,Math.max(25,p.cutoff*Math.pow(2,oct)));this.g=1-Math.exp(-TAU*this.fc/sr);this.vib=Math.pow(2,lfo*p.lfoPitch/1200);
    /* state-variable filter coefficients (topology-preserving transform) for the 12 dB/oct LP, HP and BP modes */
    const gg=Math.tan(Math.PI*this.fc/sr);this.k=2-1.96*Math.min(1,p.res);this.a1=1/(1+gg*(gg+this.k));this.a2=gg*this.a1;this.a3=gg*this.a2;}
  /* ladder: four saturating one-pole stages with global negative feedback (resonance) */
  ladder(x,s,g,res,drv){const fb=res*4.1;let u=ftanh(drv*(x-fb*s[3]));
    s[0]+=g*(u-ftanh(s[0]));s[1]+=g*(ftanh(s[0])-ftanh(s[1]));s[2]+=g*(ftanh(s[1])-ftanh(s[2]));s[3]+=g*(ftanh(s[2])-ftanh(s[3]));return s[3];}
  svf(x,s,t){const k=this.k,v3=x-s[1],v1=this.a1*s[0]+this.a2*v3,v2=s[1]+this.a2*s[0]+this.a3*v3;s[0]=2*v1-s[0];s[1]=2*v2-s[1];
    return t==='hp12'?x-k*v1-v2:t==='bp12'?v1*Math.min(1,k*3):v2;}
  render(){const p=this.E.p,sr=this.sr,f=this.f*this.vib,d=Math.pow(2,p.detune/1200),U=this.U,dc=(p.uniDet||0)/1200,w=p.uniWidth??.5;
    /* FM: osc1's phase is pushed by a sine modulator at fmRatio x pitch; the filter envelope sets the index, so bells start bright and mellow */
    let pm=0;if(p.fm>0){this.phm=(this.phm+f*p.fmRatio/sr)%1;pm=Math.sin(TAU*this.phm)*p.fm*6*(.2+.8*this.fe)/TAU;}
    let aL=0,aR=0;
    for(let u=0;u<U;u++){const r=dc?Math.pow(2,this.det[u]*dc):1,dt1=f/d*r/sr,dt2=f*d*r/sr;
      const o1=this.osc(((this.ph1[u]+pm)%1+1)%1,dt1,p.wave1),o2=this.osc(this.ph2[u],dt2,p.wave2);this.ph1[u]=(this.ph1[u]+dt1)%1;this.ph2[u]=(this.ph2[u]+dt2)%1;
      const s=o1*(1-p.mix)+o2*p.mix*.85,pl=1-w*this.pn[u],pr=1+w*this.pn[u];aL+=s*pl;aR+=s*pr;}
    const nrm=Math.pow(U,-.62);this.ps=(this.ps+f/2/sr)%1;const sub=(this.ps<.5?1:-1)*p.sub*.7,nz=(Math.random()*2-1)*p.noise*.5;
    aL=aL*nrm+sub+nz;aR=aR*nrm+sub+nz;
    const amp=this.ae*(.35+.65*this.vel)*.4,t=p.ftype||'lp24';
    if(t==='lp24'){this.l=this.ladder(aL,this.s,this.g,p.res,p.drive)*amp;this.r=this.ladder(aR,this.s2,this.g,p.res,p.drive)*amp;}
    else{const dv=p.drive;this.l=this.svf(ftanh(dv*aL)/Math.min(dv,1.5),this.sv,t)*amp;this.r=this.svf(ftanh(dv*aR)/Math.min(dv,1.5),this.sv2,t)*amp;}}
  dead(){return(((this.ac=(this.ac+1)&255))===0)&&this.stage==='r'&&this.ae<1e-4;}
  viz(){return {fc:this.fc,ae:this.ae,fe:this.fe};}
}
/* biquads (RBJ cookbook, transposed direct form II) for the horn's bell, mutes and vintage chain */
function bqc(t,f,Q,sr,gDb=0){const w=TAU*Math.min(f,sr*.45)/sr,c=Math.cos(w),s=Math.sin(w),al=s/(2*Q),A=Math.pow(10,gDb/40);let b0,b1,b2,a0,a1,a2;
  if(t==='lp'){b0=(1-c)/2;b1=1-c;b2=b0;a0=1+al;a1=-2*c;a2=1-al;}else if(t==='hp'){b0=(1+c)/2;b1=-(1+c);b2=b0;a0=1+al;a1=-2*c;a2=1-al;}
  else{b0=1+al*A;b1=-2*c;b2=1-al*A;a0=1+al/A;a1=-2*c;a2=1-al/A;}return [b0/a0,b1/a0,b2/a0,a1/a0,a2/a0];}
function bqr(c,s,x){const y=c[0]*x+s[0];s[0]=c[1]*x-c[3]*y+s[1];s[1]=c[2]*x-c[4]*y;return y;}
/* Trumpet: an outward-striking lip valve on a waveguide bore.
   Lips: a mass–spring oscillator tuned below the note (×0.75), pushed open by the mouth−mouthpiece pressure difference;
   the air through the slit follows Bernoulli (U = h·√Δp), solved exactly against the bore every sample.
   Bore: one delay line two periods long (the lips lock onto its 2nd resonance, as on a real trumpet); the bell
   reflects the lows back and lets the highs out (in-loop low-pass). Playing frequency measured against the model
   and corrected (it drifts sharp upward in the register by up to ~50 ¢ uncorrected).
   Dynamics: blown softly, little of the bore's energy above the 2nd–3rd harmonic leaves the bell (round tone);
   blown hard, the pressure wave steepens on its way down the tube (the high-pressure crest travels faster),
   which is what turns a trumpet "brassy" at ff. Then mute, bell radiation and a vintage (ribbon mic / tape) chain. */
const HORN_MUTE={open:[],cup:[['pk',850,1.6,4],['lp',2300,.7]],harmon:[['hp',650,.7],['pk',1750,3.5,11],['lp',4200,.7]],felt:[['lp',1500,.6]]};
class HornV{
  constructor(E,note,vel,o={}){this.E=E;this.sr=E.sr;this.type='horn';this.vel=vel;this.down=true;this.ac=0;this.cnt=0;
    /* section: a second player doubles the line — a few cents apart, a few ms late, on the other side of the stereo field */
    const en=o.twin?0:(E.p.hEns||0);this.det=o.det||-4*en;this.pan=o.pan??-.6*en;this.wait=o.lag||0;
    this.tw=en>0?new HornV(E,note,vel*.93,{twin:1,det:4.5*en,pan:.6*en,lag:Math.round((.006+.012*en)*E.sr)}):null;
    this.buf=new Float64Array(8192);this.wi=0;this.x=0;this.xv=0;this.dp=0;this.lp=0;this.dcx=0;this.dcy=0;this.open=0;
    this.sb=new Float64Array(64);this.si=0;this.bdc=0;this.yp=0;this.sc=[0,0,0,0,0];this.sst=[0,0];
    this.ae=0;this.t=0;this.vph=Math.random();this.wph=Math.random();this.nz=0;this.note=note;this.ft=this.f=mtof(note);this.l=this.r=0;
    this.hist=new Float32Array(256);this.hl=new Float32Array(256);this.hi=0;this.hc=0;this.chain();this.tick(0);}
  retrig(note,vel,legato){this.note=note;this.ft=mtof(note);if(!legato){this.vel=vel;this.t=0;this.f=this.ft;}this.down=true;if(this.tw)this.tw.retrig(note,vel*.93,legato);}
  release(){this.down=false;if(this.tw)this.tw.release();}
  /* bell + mute + "old record" chain: ribbon-mic/tape bandwidth closing in as the vintage amount rises */
  chain(){const p=this.E.p,sr=this.sr,fl=p.hornType==='flugel',rt=p.retro;
    const L=[['hp',90+60*rt,.7],fl?['lp',2600,.6]:['pk',1300,1,3],...(HORN_MUTE[p.mute]||[]),['lp',9000-5600*rt,.65],['pk',260,.8,2.5*rt]];
    this.cs=L.map(([t,f,q,g])=>bqc(t,f,q,sr,g||0));this.ss=L.map(()=>[0,0]);this.ck=p.hornType+p.mute+rt;}
  tick(k){const p=this.E.p,sr=this.sr;if(this.ck!==p.hornType+p.mute+p.retro)this.chain();
    /* legato: the lips hop to the next resonance in ~20 ms */
    if(this.f!==this.ft){const c=Math.exp(-k/(.022*sr));this.f=this.ft+(this.f-this.ft)*c;if(Math.abs(this.f/this.ft-1)<1e-4)this.f=this.ft;}
    this.t+=k;const ts=this.t/sr;
    /* vibrato fades in after the note has settled, as players do; "wow" is the slow pitch drift of old tape */
    const vd=p.vibD*Math.min(1,Math.max(0,(ts-.28)/.6));this.vph=(this.vph+k*p.vibR/sr)%1;this.wph=(this.wph+k*.55/sr)%1;
    /* scoop: pop players often lip up into the note from just below */
    const sc=(p.hScoop||0)*Math.exp(-ts/.07);
    const fe=this.f*Math.pow(2,(Math.sin(TAU*this.vph)*vd+Math.sin(TAU*this.wph)*p.retro*3+this.det-sc)/1200),fl=p.hornType==='flugel';this.fe=fe;
    /* bell reflection cutoff ~1.5 kHz (trumpet) / ~1 kHz (the conical flugelhorn keeps fewer highs) */
    const lc=fl?.125:.186,a=1-lc,w=TAU*fe/sr;this.lc=lc;
    const pdLp=Math.atan2(a*Math.sin(w),1-a*Math.cos(w))/w,pdDc=-((Math.PI/2-w/2)-Math.atan2(.995*Math.sin(w),1-.995*Math.cos(w)))/w;
    const s=12*Math.log2(fe/164.81),corr=Math.pow(2,(.234*s+.0412*s*s+(fl?3.23+.386*s+.0121*s*s:0))/1200);/* measured pitch pull of the lips, removed */
    this.D=Math.max(4,Math.min(8000,2*sr/(fe/corr)-pdLp-pdDc));
    this.wl=TAU*Math.min(fe*.75*p.lipR,sr*.4);
    /* breath: soft onset (most of the "soft" attack), short release */
    const att=p.hAtt*(1.25-.5*this.vel),tg=this.down?1:0,tc=this.down?att:.06;if(k)this.ae=tg+(this.ae-tg)*Math.exp(-k/(tc*sr));
    this.P0=p.blow*(.42+.68*Math.pow(this.vel,1.3));
    /* how hard it is being blown → how much of the spectrum gets out and how much the wave steepens */
    const b=Math.max(0,Math.min(1.4,(this.P0*this.ae-.3)/.8));this.bri=b;
    this.sc=bqc('lp',fe*(fl?1.7:2.3)*(1+(p.hC??5)*b*b),.6,sr);}
  render(){const p=this.E.p,sr=this.sr;if(this.wait>0){this.wait--;this.l=this.r=0;return;}if(((this.cnt++)&15)===0)this.tick(16);
    this.nz+=((Math.random()*2-1)-this.nz)*.35;
    const pm=this.P0*this.ae*(1+this.nz*.03)*.1;
    /* bore: the wave coming back from the bell (3rd-order Lagrange read), low-passed by the bell's reflection */
    const B=this.buf,M=8191,n0=Math.floor(this.D)-1,dl=this.D-n0,j=this.wi-n0+8192;
    const xd=B[j&M]*(-(dl-1)*(dl-2)*(dl-3)/6)+B[(j-1)&M]*(dl*(dl-2)*(dl-3)/2)+B[(j-2)&M]*(-dl*(dl-1)*(dl-3)/2)+B[(j-3)&M]*(dl*(dl-1)*(dl-2)/6);
    this.lp+=(xd-this.lp)*this.lc;const pr=.97*this.lp;
    /* lips: mass–spring, pushed by Δp; the slit opening is h = max(0, x) */
    const wl=this.wl,acc=wl*wl*(.01+3*this.dp-this.x)-wl/5*this.xv;this.xv+=acc/sr;this.x+=this.xv/sr;
    const h=this.x>0?this.x:0,Z=4,q=pm-2*pr,zh=Z*h;let U;
    /* Bernoulli flow, solved exactly against the bore: U = h·sign(Δp)·√|Δp|, p_mouthpiece = 2p⁻ + Z·U */
    if(q>=0){const s=(-zh+Math.sqrt(zh*zh+4*q))/2;this.dp=s*s;U=h*s;}else{const r=(-zh+Math.sqrt(zh*zh-4*q))/2;this.dp=-r*r;U=-h*r;}
    const pp=pr+Z*U,bore=pr+pp;this.open=h;
    const dcy=pp-this.dcx+.995*this.dcy;this.dcx=pp;this.dcy=dcy;B[this.wi]=dcy;this.wi=(this.wi+1)&M;
    /* mouthpiece pressure → what gets out of the bell at this blowing strength */
    this.bdc+=(bore-this.bdc)*.0004;let y=bqr(this.sc,this.sst,bore-this.bdc);
    /* nonlinear propagation: the crest of the wave travels faster than the trough, so loud waves steepen (brassiness) */
    const ref=Math.max(1e-6,pm*1.2),S=p.hornType==='flugel'?.5:1;this.sb[this.si]=y;
    const dd=Math.max(1,Math.min(46,24-(p.hS??14)*S*this.bri*this.bri*Math.max(-1,Math.min(1,y/ref)))),di=Math.floor(dd),df=dd-di;
    y=this.sb[(this.si-di+64)&63]*(1-df)+this.sb[(this.si-di-1+64)&63]*df;this.si=(this.si+1)&63;
    /* radiation from the bell rises with frequency */
    let out=(y+(p.hR??.6)*(y-this.yp)*sr/(TAU*1200))*1.5+this.nz*p.breath*.0005*this.ae*this.P0;this.yp=y;
    for(let j=0;j<this.cs.length;j++)out=bqr(this.cs[j],this.ss[j],out);
    if(p.retro>0){const dv=1+2.5*p.retro;out=ftanh(out*dv)/dv;}
    if(((this.hc=(this.hc+1)&3))===0){this.hist[this.hi]=bore;this.hl[this.hi]=h;this.hi=(this.hi+1)&255;}
    const gl=Math.cos((this.pan+1)*Math.PI/4),gr=Math.sin((this.pan+1)*Math.PI/4);this.l=out*gl;this.r=out*gr;
    if(this.tw){this.tw.render();this.l=(this.l+this.tw.l)*.62;this.r=(this.r+this.tw.r)*.62;}}
  dead(){return(((this.ac=(this.ac+1)&255))===0)&&!this.down&&this.ae<1e-4&&(!this.tw||this.tw.ae<1e-4);}
  viz(){return {hist:this.hist,hl:this.hl,hi:this.hi,f:this.f,open:this.open,bri:this.bri};}
}class KeysDSP{
  constructor(sr){this.sr=sr;this.p={instr:'piano',hard:.5,inharm:1,stretch:1,unison:1,sustain:1,epType:'rhodes',bark:.5,epAmp:1,trem:4.5,tremD:.3,
    wave1:'saw',wave2:'square',detune:7,mix:.5,sub:.2,noise:0,cutoff:900,res:.3,envAmt:.6,drive:1.4,keyTrack:.5,aA:.003,aD:.4,aS:.6,aR:.3,fA:.002,fD:.3,fS:.2,fR:.3,
    glide:0,mono:false,lfoRate:5,lfoPitch:0,lfoFilt:0,uni:1,uniDet:0,uniWidth:.5,ftype:'lp24',fm:0,fmRatio:2,pump:0,pumpSync:true,bpm:128,
    arp:false,arpRate:4,arpOct:2,arpMode:'up',arpGate:.5,
    hornType:'trumpet',mute:'open',blow:1,lipR:1,breath:.3,hAtt:.06,vibD:12,vibR:5.2,retro:.5,hMono:true,hC:5,hEns:0,hScoop:0};
    this.v=[];this.q=[];this.pedal=false;this.cnt=0;this.lfo=0;this.lph=0;this.tph=0;this.last=null;this.held=[];this.mono=null;this.dcl=[0,0,0,0];
    this.pumpT=1e9;this.beatCnt=0;this.arpHeld=[];this.arpNext=-1;this.arpIdx=0;this.arpVoice=null;this.arpOff=-1;}
  handle(m){if(m.type==='params'){Object.assign(this.p,m.p);if(!this.p.arp||this.p.instr!=='synth'){this.arpHeld=[];}}
    else if(m.type==='ev'){for(const e of m.list){e.f=e.t?Math.round(e.t*this.sr):0;let i=this.q.length;while(i>0&&this.q[i-1].f>e.f)i--;this.q.splice(i,0,e);}}
    else if(m.type==='clear'){this.q.length=0;this.pedal=false;this.held=[];this.arpHeld=[];this.v.forEach(v=>v.release());this.v.forEach(v=>v.damper&&v.damper());}}
  /* arpeggiator: steps through the held notes (sorted, over N octaves) on the tempo grid; each step is a fresh voice gated to a fraction of the step */
  arpTick(frame){const p=this.p,step=Math.max(1,Math.round(this.sr*60/p.bpm/p.arpRate));this.arpNext=frame+step;
    const base=this.arpHeld.map(h=>h.note).sort((a,b)=>a-b),seq=[];for(let o=0;o<p.arpOct;o++)base.forEach(n=>seq.push(n+12*o));
    let order=seq;if(p.arpMode==='down')order=seq.slice().reverse();else if(p.arpMode==='updown')order=seq.length>2?seq.concat(seq.slice(1,-1).reverse()):seq;
    const n=p.arpMode==='random'?seq[Math.floor(Math.random()*seq.length)]:order[this.arpIdx%order.length];
    const vel=this.arpHeld[this.arpHeld.length-1].vel*(this.arpIdx%4===0?1:.82);this.arpIdx++;
    if(this.arpVoice&&this.arpVoice.down)this.arpVoice.release();
    if(p.mono&&this.mono&&this.v.includes(this.mono)){this.mono.retrig(n,vel,false);this.arpVoice=this.mono;}else{const v=new SynV(this,n,vel);this.v.push(v);this.arpVoice=v;if(p.mono)this.mono=v;}
    this.last=this.arpVoice;this.arpOff=frame+Math.max(1,Math.round(step*p.arpGate));}
  apply(e,frame){const p=this.p;
    if(e.kind==='pedal'){this.pedal=!!e.v;if(!this.pedal)this.v.forEach(v=>v.damper&&v.damper());return;}
    if(e.kind==='duck'){this.pumpT=0;return;}/* sidechain trigger, e.g. from a kick drum */
    if(p.instr==='synth'&&p.arp&&(e.kind==='on'||e.kind==='off')){
      if(e.kind==='on'){if(!this.arpHeld.length){this.arpNext=frame;this.arpIdx=0;}this.arpHeld=this.arpHeld.filter(h=>h.note!==e.note);this.arpHeld.push({note:e.note,vel:Math.max(.02,Math.min(1,e.vel))});}
      else{this.arpHeld=this.arpHeld.filter(h=>h.note!==e.note);if(!this.arpHeld.length&&this.arpVoice&&this.arpVoice.down)this.arpVoice.release();}
      return;}
    const lead=p.instr==='synth'||p.instr==='horn',mono=p.instr==='horn'?p.hMono:p.mono,VC=p.instr==='horn'?HornV:SynV;
    if(e.kind==='on'){const vel=Math.max(.02,Math.min(1,e.vel));
      if(lead){
        if(mono){const legato=this.held.length>0;this.held.push(e.note);
          if(this.mono&&this.mono.type===p.instr&&this.v.includes(this.mono))this.mono.retrig(e.note,vel,legato);else{this.mono=new VC(this,e.note,vel);this.v.push(this.mono);}this.last=this.mono;}
        else{const nv=new VC(this,e.note,vel);this.v.push(nv);this.last=nv;this.held.push(e.note);}
      }else{let v=this.v.find(x=>x.note===e.note&&x.type===p.instr);if(!v){v=p.instr==='piano'?new PianoV(this,e.note):new EPV(this,e.note);this.v.push(v);}v.strike(vel);this.last=v;}
      if(this.v.length>40){let qi=-1,qe=1e9;this.v.forEach((v,i)=>{if(v===this.last)return;const en=v.b?v.b.energy():v.ae;if(en<qe){qe=en;qi=i;}});if(qi>=0)this.v.splice(qi,1);}
      return;}
    if(e.kind==='off'){this.held=this.held.filter(n=>n!==e.note);
      if(lead&&mono&&this.mono&&this.mono.type===p.instr){if(this.held.length)this.mono.retrig(this.held[this.held.length-1],this.mono.vel,true);else this.mono.release();return;}
      this.v.forEach(v=>{if(v.note===e.note&&v.down)v.release();});}}
  render(L,R,n,start){const p=this.p;
    for(let i=0;i<n;i++){const frame=start+i;
      while(this.q.length&&this.q[0].f<=frame)this.apply(this.q.shift(),frame);
      if(p.arp&&this.arpHeld.length&&frame>=this.arpNext)this.arpTick(frame);
      if(this.arpVoice&&this.arpVoice.down&&frame>=this.arpOff)this.arpVoice.release();
      if(p.pump>0&&p.pumpSync&&p.instr==='synth'){if(++this.beatCnt>=this.sr*60/p.bpm){this.beatCnt=0;this.pumpT=0;}}
      if((this.cnt++&15)===0){this.lph=(this.lph+16*p.lfoRate/this.sr)%1;this.lfo=Math.sin(TAU*this.lph);this.tph=(this.tph+16*p.trem/this.sr)%1;
        for(const v of this.v)if(v.type==='synth')v.mod(16,this.lfo);}
      let l=0,r=0;
      for(let k=0;k<this.v.length;k++){const v=this.v[k];let a,b;if(v.type==='synth'||v.type==='horn'){v.render();a=v.l;b=v.r;}else{const y=v.render();a=y*v.gl;b=y*v.gr;}
        /* safety: a voice that ever produces a non-finite sample is dropped, so it cannot silence everything downstream */
        if(!Number.isFinite(a)||!Number.isFinite(b)){this.v.splice(k,1);k--;continue;}
        l+=a;r+=b;if(v.dead()){this.v.splice(k,1);k--;}}
      if(p.instr==='ep'&&p.tremD>0){/* stereo tremolo (auto-pan), as on the suitcase models */
        const s=Math.sin(TAU*this.tph)*p.tremD;l*=1-s;r*=1+s;}
      if(p.pump>0&&p.instr==='synth'){/* sidechain "pump": the level ducks on each beat (or kick) and swells back over roughly half a beat */
        const rel=Math.min(.42,45/p.bpm)*this.sr;if(this.pumpT<rel){const u=1-this.pumpT/rel,gd=1-.95*p.pump*Math.pow(u,1.3);l*=gd;r*=gd;}this.pumpT++;}
      const dc=this.dcl,yl=l-dc[0]+.9995*dc[1];dc[0]=l;dc[1]=yl;const yr=r-dc[2]+.9995*dc[3];dc[2]=r;dc[3]=yr;
      if(!Number.isFinite(yl)||!Number.isFinite(yr)){dc.fill(0);L[i]=R[i]=0;continue;}
      L[i]=Math.max(-4,Math.min(4,yl));R[i]=Math.max(-4,Math.min(4,yr));}}
  snap(){const v=this.last&&this.v.includes(this.last)?this.last:null;return {n:this.v.length,pedal:this.pedal,viz:v?v.viz():null,type:v?v.type:null};}
}

  return KeysDSP;
  };
})(typeof window !== "undefined" ? (window.US = window.US || {}) : (module.exports = {}));
