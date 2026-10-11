/* phys/dsp-guitar.js — 物理モデル音源の計算部（Rosewood guitar）。録音素材は含まない。
   関数で包んでおき、AudioWorkletにはこの関数の文字列を渡し、オフライン書き出しでは直接呼ぶ。 */
(function (root) {
  root.physDsp = root.physDsp || {};
  root.physDsp.guitar = function () {

/* Plucked-string engine (guitar & bass): dual-polarisation digital waveguides, Lagrange fractional delay,
   passive bridge junction (sympathetic coupling), fret / fingerboard collision, tension modulation.
   Plain math only, so it ports 1:1 to C++ for a plugin build. */
const MIDI=m=>440*Math.pow(2,(m-69)/12);
const MASK=4095;
class WG{constructor(){this.b=new Float32Array(4096);this.w=0;this.x1=0;this.a=0;this.p0=0;this.q0=0;this.p1=0;this.q1=0;this.env=0;this.av=0;}
  clear(){this.b.fill(0);this.x1=this.p0=this.q0=this.p1=this.q1=this.env=0;}
  scale(k){for(let i=0;i<4096;i++)this.b[i]*=k;this.x1*=k;this.p0*=k;this.q0*=k;this.p1*=k;this.q1*=k;}
  step(D,g,s){const b=this.b,w=this.w,dd=D-1,i=dd|0,t=dd-i;
    const ym=b[(w-i+1)&MASK],y0=b[(w-i)&MASK],y1=b[(w-i-1)&MASK],y2=b[(w-i-2)&MASK];
    const rd=-t*(t-1)*(t-2)/6*ym+(t+1)*(t-1)*(t-2)/2*y0-(t+1)*t*(t-2)/2*y1+(t+1)*t*(t-1)/6*y2;
    let x=g*((1-s)*rd+s*this.x1);this.x1=rd;const a=this.a;
    let y=a*x+this.p0-a*this.q0;this.p0=x;this.q0=y;x=y;
    y=a*x+this.p1-a*this.q1;this.p1=x;this.q1=y;
    this.w=(w+1)&MASK;b[this.w]=y;}
  disp(x,N){return this.b[(this.w-x)&MASK]-this.b[(this.w-(N-x))&MASK];}
}
class GString{
  constructor(sr,idx,dsp){this.sr=sr;this.idx=idx;this.dsp=dsp;this.v=new WG();this.h=new WG();
    this.open=40;this.fret=0;this.pc=40;this.pt=40;this.glide=0;this.bend=0;this.bendT=0;this.bendR=0;
    this.vibD=0;this.vibR=5.5;this.vibPh=0;this.autoT=-1;this.fd=0;this.D=100;this.Dh=100;this.M=50;this.Mh=50;this.N=100;this.Nh=100;
    this.g=.99;this.gP=.9;this.s=.2;this.dampG=1;this.dampUntil=-1;this.palm=false;this.harmFrac=0;this.harmUntil=-1;
    this.cx=new Int32Array(8);this.ch=new Float32Array(8);this.nc=0;this.lv=0;this.tmp=new Float32Array(2200);this.tmp2=new Float32Array(2200);}
  tune(){const p=this.dsp.p,sr=this.sr,f=MIDI(this.open+this.fret),w0=2*Math.PI*f/sr,Dt=sr/f;
    this.s=.5-.47*Math.pow(p.bright,.7);const a=-.55*p.stiff*(this.idx<p.wound?.75:1);this.v.a=this.h.a=a;
    let ph=Math.atan2(-this.s*Math.sin(w0),(1-this.s)+this.s*Math.cos(w0));
    ph+=2*(Math.atan2(-Math.sin(w0),a+Math.cos(w0))-Math.atan2(-a*Math.sin(w0),1+a*Math.cos(w0)));
    this.fd=-ph/w0;
    const T60=p.sustain*Math.pow(f/196,-.4);
    this.g=Math.pow(10,-3*(Dt/sr)/T60);this.gP=Math.pow(10,-3*(Dt/sr)/.28);this.dampG=Math.pow(10,-3*(Dt/sr)/.045);
    const M=Math.floor((Dt-this.fd)/2),boardEnd=1-Math.pow(2,-20/12),act=1-Math.pow(2,-this.fret/12);this.nc=0;
    if(p.fretless){/* bare fingerboard right under the string: the "mwah" growl */
      for(const fj of [.02,.04,.07,.11,.16,.22]){if(act+(1-act)*fj>boardEnd)break;const xi=Math.round(fj*M);if(xi<2)continue;
        this.cx[this.nc]=xi;this.ch[this.nc]=p.action*(.012+.2*fj);this.nc++;}}
    else for(const j of [1,2,3,5,7,10,14]){if(this.fret+j>20)break;const fj=1-Math.pow(2,-j/12),xi=Math.round(fj*M);if(xi<2)continue;
      this.cx[this.nc]=xi;this.ch[this.nc]=p.action*(.05+.6*fj);this.nc++;}}
  upd(frame,k){const p=this.dsp.p,sr=this.sr;
    if(this.pc!==this.pt){const d=this.glide*k;this.pc=Math.abs(this.pt-this.pc)<=d?this.pt:this.pc+Math.sign(this.pt-this.pc)*d;}
    if(this.bend!==this.bendT){const d=this.bendR*k;this.bend=Math.abs(this.bendT-this.bend)<=d?this.bendT:this.bend+Math.sign(this.bendT-this.bend)*d;}
    let vd=this.vibD;
    if(vd<=0&&p.autoVib>0&&this.autoT>=0&&frame>this.autoT)vd=p.autoVib*28*Math.min(1,(frame-this.autoT)/(.45*sr));
    if(vd>0)this.vibPh+=2*Math.PI*this.vibR*k/sr;
    const pitch=this.pc+this.bend+(vd>0?vd/100*Math.sin(this.vibPh):0);
    const e=this.v.env+this.h.env*.5,tmf=1+p.tm*.25*e/(1+4*e);
    let D=sr/MIDI(pitch)/tmf-this.fd;if(D<6)D=6;if(D>4000)D=4000;
    this.D=D;this.Dh=D*(1+p.detune*.0011);this.M=Math.floor(D/2);this.Mh=Math.floor(this.Dh/2);this.N=Math.round(D);this.Nh=Math.round(this.Dh);}
  blur(y,n,r){if(r<1)return;const t=this.tmp2,inv=1/(2*r+1);for(let pass=0;pass<2;pass++){let acc=0;
    for(let i=0;i<n;i++)t[i]=y[i];for(let i=-r;i<=r;i++)acc+=t[Math.min(n-1,Math.max(0,i))];
    for(let i=0;i<n;i++){y[i]=acc*inv;acc+=t[Math.min(n-1,i+r+1)]-t[Math.max(0,i-r)];}}}
  /* add a released-displacement shape (rounded triangle) to both polarisations.
     Strikes are modelled as sharp releases too: a velocity step leaves a gauge offset in the waves that clicks on re-fretting. */
  shape(A,qa,width,wv,wh){const M=this.M,y=this.tmp;
    const xp=Math.max(1,Math.min(M-1,Math.round(M*(1-qa))));
    for(let x=0;x<=M;x++)y[x]=x<=xp?A*x/xp:A*(M-x)/(M-xp);
    this.blur(y,M+1,Math.round(width));
    const e0=y[0],e1=y[M];for(let x=0;x<=M;x++)y[x]-=e0+(e1-e0)*x/M;
    const put=(wg,N,wt)=>{if(!wt)return;const b=wg.b,w=wg.w;
      for(let x=0;x<=M;x++){const v=.5*y[x]*wt;b[(w-x)&MASK]+=v;b[(w-(N-x))&MASK]-=v;}};
    put(this.v,this.N,wv);put(this.h,this.Nh,wh);}
  excite(e,frame){const p=this.dsp.p,tech=e.tech||'pick';let fret=e.fret;
    if(tech==='harm'){this.harmFrac=1-Math.pow(2,-((fret>0?fret:12))/12);fret=0;}
    if(fret!=null&&fret>=0&&fret!==this.fret){this.fret=fret;this.tune();}
    this.pt=this.pc=this.open+this.fret;this.bend=this.bendT=0;this.vibD=0;this.autoT=frame+Math.round(.3*this.sr);this.upd(frame,0);
    const keep=tech==='finger'?.45:tech==='pick'||tech==='palm'?.3:.2;
    this.v.scale(keep);this.h.scale(keep);
    this.dampUntil=-1;this.harmUntil=-1;this.palm=tech==='palm';
    const vel=e.vel!=null?e.vel:p.vel,M=this.M;let q=e.pos!=null?e.pos:p.pos;
    const qa=qq=>Math.min(.85,Math.max(.03,qq*Math.pow(2,this.fret/12)));
    if(tech==='slap')this.shape(-1.3*vel,qa(.3),M*.012,1,.12),this.dsp.click(vel*1.4);
    else if(tech==='ghost')this.shape(-.4*vel,qa(.3),M*.02,1,.1),this.dsp.click(vel*.6);
    else if(tech==='pop')this.shape(1.5*vel,qa(.27),M*.012,1,.25),this.dsp.click(vel*.8);
    else if(tech==='finger')this.shape(.45*vel,qa(q),M*.05,.75,.66),this.dsp.click(vel*.15);
    else this.shape(.5*vel,qa(q),M*.008,.55,.83),this.dsp.click(vel);
    if(tech==='harm')this.harmUntil=frame+Math.round(.06*this.sr);
    if(tech==='ghost')this.dampUntil=frame+Math.round(.04*this.sr);}
  legato(e,frame){if(e.fret==null||e.fret<0||e.fret===this.fret)return;
    this.fret=e.fret;this.tune();this.pt=this.open+this.fret;
    const time=e.time||(e.type==='slide'?.009:.0016);this.glide=Math.abs(this.pt-this.pc)/(time*this.sr);
    this.dampUntil=-1;this.harmUntil=-1;const vel=e.vel!=null?e.vel:.7,M=this.M;
    if(e.type==='hammer')this.shape(.09*vel,.9,M*.01,1,.2);
    else if(e.type==='pull')this.shape(.22*vel,.9,M*.01,.4,1);
    else this.dsp.scrape(vel*(this.dsp.p.fretless?.3:1));}
}
class GuitarDSP{
  constructor(sr){this.sr=sr;
    this.p={sustain:4.5,bright:.72,stiff:.3,action:1,vel:.8,pos:.18,width:.6,mode:'acoustic',pickup:.16,tm:.3,symp:.5,detune:.4,autoVib:0,
      nStr:6,zs:[1.7,1.45,1.2,1.0,.8,.62],wound:3,fretless:false};
    this.st=[];
    for(let i=0;i<6;i++){const s=new GString(sr,i,this);s.open=[40,45,50,55,59,64][i];s.pc=s.pt=s.open;s.tune();s.upd(0,0);this.st.push(s);}
    this.q=[];this.cnt=0;this.uvp=0;this.uhp=0;this.ck=0;this.sc=0;this.nlp=0;this.dcl=[0,0,0,0];this.lpl=0;this.lpr=0;
    this.ckD=Math.pow(.37,1/(.008*sr));this.scD=Math.pow(.37,1/(.03*sr));
    this.shp=new Float32Array(6*48);}
  click(a){this.ck=Math.max(this.ck,a*.04);}
  scrape(a){this.sc=Math.max(this.sc,a*.03);}
  handle(m){
    if(m.type==='params'){Object.assign(this.p,m.p);this.st.forEach(s=>{s.tune();s.upd(0,0);});}
    else if(m.type==='tuning'){m.midi.forEach((v,i)=>{const s=this.st[i];if(s.open!==v){s.open=v;s.pc=s.pt=v+s.fret;s.v.clear();s.h.clear();s.tune();s.upd(0,0);}});
      for(let i=m.midi.length;i<6;i++){this.st[i].v.clear();this.st[i].h.clear();}}
    else if(m.type==='ev'){for(const e of m.list){e.f=e.t?Math.round(e.t*this.sr):0;let i=this.q.length;while(i>0&&this.q[i-1].f>e.f)i--;this.q.splice(i,0,e);}}
    else if(m.type==='clear'){this.q.length=0;this.st.forEach(s=>{s.vibD=0;s.bendT=0;});}
  }
  apply(e,frame){const s=this.st[e.s];if(!s||e.s>=this.p.nStr)return;
    switch(e.kind){
      case 'damp':s.dampUntil=frame+Math.round((e.dur||.08)*this.sr);break;
      case 'legato':s.legato(e,frame);break;
      case 'bend':s.bendT=e.semis;s.bendR=Math.abs(s.bendT-s.bend)/(Math.max(.005,e.time||.1)*this.sr);break;
      case 'vib':s.vibD=e.depth||0;s.vibR=e.rate||5.5;break;
      default:s.excite(e,frame);}}
  render(L,R,n,start){
    const st=this.st,p=this.p,elec=p.mode==='electric',ns=p.nStr,ZS=p.zs;
    /* collision stiffness: a hard stop reads as snap through a pickup, but the acoustic bridge-velocity output turns it into clicks */
    const coll=elec?1:.15;
    let SZ=0;for(let k=0;k<ns;k++)SZ+=ZS[k];
    const Rv=250+2400*(1-p.symp),Rh=Rv*5,kv=2/(Rv+SZ),kh=2/(Rh+SZ),ov=(Rv+SZ)*14,oh=(Rh+SZ)*10;
    const pl=[],pr=[];for(let k=0;k<ns;k++){const a=(k-(ns-1)/2)/((ns-1)/2)*p.width*.7,th=(a+1)*Math.PI/4;pl.push(Math.cos(th));pr.push(Math.sin(th));}
    const dc=this.dcl;
    for(let i=0;i<n;i++){
      const frame=start+i;
      while(this.q.length&&this.q[0].f<=frame)this.apply(this.q.shift(),frame);
      if((this.cnt++&7)===0)for(let k=0;k<ns;k++)st[k].upd(frame,8);
      let sv=0,sh=0;
      for(let k=0;k<ns;k++){const s=st[k];
        let g=s.palm?s.gP:s.g,sf=s.palm?Math.min(.5,s.s+.25):s.s;if(frame<s.dampUntil)g*=s.dampG;
        s.v.step(s.D,g,sf);s.h.step(s.Dh,g,sf);
        const av=s.v.b[(s.v.w-s.M)&MASK],ah=s.h.b[(s.h.w-s.Mh)&MASK];s.v.av=av;s.h.av=ah;
        sv+=ZS[k]*av;sh+=ZS[k]*ah;s.v.env+=(av*av-s.v.env)*.003;s.h.env+=(ah*ah-s.h.env)*.003;}
      const uv=kv*sv,uh=kh*sh;let l=0,r=0;
      for(let k=0;k<ns;k++){const s=st[k],V=s.v,H=s.h,bv=V.b,bh=H.b,wv=V.w,wh=H.w;
        bv[(wv-s.M)&MASK]=V.av-uv;bh[(wh-s.Mh)&MASK]=H.av-uh;
        for(let c=0;c<s.nc;c++){const xi=s.cx[c],i1=(wv-xi)&MASK,i2=(wv-(s.N-xi))&MASK,d=bv[i1]-bv[i2],h=s.ch[c];
          if(d<-h){const cor=(-h-d)*coll;bv[i1]+=cor;bv[i2]-=cor;}}
        if(frame<s.harmUntil){const xv=Math.round(s.harmFrac*s.M);
          for(const [wg,N] of [[V,s.N],[H,s.Nh]]){const b=wg.b,i1=(wg.w-xv)&MASK,i2=(wg.w-(N-xv))&MASK,d=(b[i1]-b[i2])*.25;b[i1]-=d;b[i2]+=d;}}
        const a=Math.abs(V.av)+Math.abs(H.av);if(a>s.lv)s.lv=a;
        if(elec){const M=s.M,xp=Math.max(2,Math.min(M-2,Math.round(p.pickup*M*Math.pow(2,s.fret/12))));
          const o=(V.disp(M-xp,s.N)*.8+H.disp(M-xp,s.Nh)*.7)*1.3;l+=o*pl[k];r+=o*pr[k];}}
      if(!elec){const o=(uv-this.uvp)*ov+(uh-this.uhp)*oh;l=r=o;}
      this.uvp=uv;this.uhp=uh;
      if(this.ck>1e-5||this.sc>1e-5){const nz=Math.random()*2-1;this.nlp+=(nz-this.nlp)*.2;const o=(nz-this.nlp)*this.ck+this.nlp*this.sc;
        l+=o;r+=o;this.ck*=this.ckD;this.sc*=this.scD;}
      this.lpl+=(l-this.lpl)*.6;this.lpr+=(r-this.lpr)*.6;l=this.lpl;r=this.lpr;/* bridge/pickup mass: gentle 7 kHz roll-off */
      const yl=l-dc[0]+.999*dc[1];dc[0]=l;dc[1]=yl;const yr=r-dc[2]+.999*dc[3];dc[2]=r;dc[3]=yr;
      L[i]=yl*.42;R[i]=yr*.42;
    }
  }
  snap(){const sh=this.shp,ns=this.p.nStr,st=this.st.slice(0,ns);
    for(let k=0;k<ns;k++){const s=st[k];for(let i=0;i<48;i++){const x=Math.round(i/47*s.M);sh[k*48+i]=s.h.disp(x,s.Nh)+.6*s.v.disp(x,s.N);}}
    const out={shape:sh.slice(),frets:st.map(s=>s.fret),lv:st.map(s=>s.lv),bend:st.map(s=>s.bend)};
    st.forEach(s=>s.lv*=.5);return out;}
}

  return GuitarDSP;
  };
})(typeof window !== "undefined" ? (window.US = window.US || {}) : (module.exports = {}));
