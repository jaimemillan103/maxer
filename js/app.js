// ===== Bloque 1 de 3 (extraído de index.html) =====
// ══ FIREBASE CONFIG — proyecto unificado (focus-to-do-millan) ══
const FB_CFG = {
  apiKey:            "AIzaSyBkWZz3GTviJAwhwWLOhy-wIhs79OuTbrU",
  authDomain:        "focus-to-do-millan.firebaseapp.com",
  projectId:         "focus-to-do-millan",
  storageBucket:     "focus-to-do-millan.firebasestorage.app",
  messagingSenderId: "475179604545",
  appId:             "1:475179604545:web:6d19b253491364c9fc44c0",
};
let auth, db, currentUser = null, saveTimer = null;
let _fbOk = false;
try {
  firebase.initializeApp(FB_CFG);
  auth = firebase.auth();
  db   = firebase.firestore();
  // Persistencia offline (multi-pestaña). Falla silenciosa si el navegador no lo soporta.
  db.enablePersistence({ synchronizeTabs: true }).catch(()=>{});
  _fbOk = true;
} catch(e) {
  const _noop = ()=>({get:()=>Promise.resolve({exists:false}),set:()=>Promise.resolve(),doc:()=>_noop(),collection:()=>_noop()});
  auth = {onAuthStateChanged:cb=>{cb(null);return()=>{}},signInWithEmailAndPassword:()=>Promise.reject({code:'auth/network-request-failed',message:'Firebase no disponible'}),createUserWithEmailAndPassword:()=>Promise.reject({code:'auth/network-request-failed',message:'Firebase no disponible'}),signInWithPopup:()=>Promise.reject({code:'auth/network-request-failed',message:'Firebase no disponible'}),signOut:()=>Promise.resolve()};
  db = {collection:()=>_noop()};
}
// Safety fallback: if onAuthStateChanged never fires (bad config / offline), show app after 3s
setTimeout(()=>{
  if(!appLoaded){
    appLoaded=true;
    loadLocal();
    document.getElementById('loadingScreen').classList.add('hidden');
    showApp();
  }
},3000);

// ══ DATA ══════════════════════════════════════════════════
const LEVELS=[
  {name:'Principiante',min:0,max:100},{name:'Aprendiz',min:100,max:300},
  {name:'Atleta',min:300,max:600},{name:'Guerrero',min:600,max:1000},
  {name:'Campeón',min:1000,max:1500},{name:'Élite',min:1500,max:2200},{name:'Leyenda',min:2200,max:9999}
];
const ACH=[
  {id:'push_any',  name:'Primera serie',     emoji:'💪',weekly:true, check:s=>Object.values(s.pushups).flat().length>0},
  {id:'push75',    name:'75 flexiones',      emoji:'🔥',weekly:true, check:s=>tPush(s)>=75},
  {id:'push_var',  name:'3 tipos flex',      emoji:'🌀',weekly:true, check:s=>Object.values(s.pushups).filter(v=>v.length>0).length>=3},
  {id:'rehab_done',name:'Rehab del día',     emoji:'🦵',weekly:true, check:s=>(s.rehabXpToday||0)>0},
  {id:'rehab_3d',  name:'3 días rehab/sem',  emoji:'📅',weekly:true, check:s=>(s.rehabDaysThisWeek||0)>=3},
  {id:'hydrated',  name:'2.5L agua',          emoji:'💧',weekly:true, check:s=>!!s.habits.agua},
  {id:'all_habits',name:'Hábitos completos', emoji:'⭐',weekly:true, check:s=>s.habits.cold&&s.habits.walk&&s.habits.reading&&s.habits.breathing&&s.habits.protein&&s.habits.deficit&&s.habits.agua&&s.habits['sueño']},
  {id:'hiper_d1',  name:'Día 1 Hipertrofia', emoji:'🚀',weekly:true, check:s=>Object.keys(s.general||{}).filter(k=>k.startsWith('h_bench')||k.startsWith('h_dips')).some(k=>(s.general[k]||[]).some(Boolean))},
  {id:'streak3',   name:'3 días seguidos',   emoji:'⚡',weekly:false,check:s=>s.streak>=3},
  {id:'streak7',   name:'1 semana seguida',  emoji:'🏆',weekly:false,check:s=>s.streak>=7},
  {id:'rehab30',   name:'30 días rehab',     emoji:'🎯',weekly:false,check:s=>s.rehabDaysTotal>=30},
  {id:'rehab90',   name:'Recuperación total',emoji:'🏅',weekly:false,check:s=>s.rehabDaysTotal>=90},
  {id:'recomp_reg',name:'Primera medición',  emoji:'📏',weekly:false,check:s=>Object.keys(s.recomp?.entries||{}).length>=1},
  {id:'recomp_7d', name:'7 registros peso',  emoji:'📉',weekly:false,check:s=>Object.keys(s.recomp?.entries||{}).length>=7},
  {id:'recomp_bf', name:'BF en objetivo',    emoji:'🎯',weekly:false,check:s=>{const entries=Object.values(s.recomp?.entries||{});const last=entries[entries.length-1];return last&&last.bf>0&&last.bf<=(s.recomp?.goal?.targetBF||11)}},
];
const HABITS=[
  {id:'cold',     emoji:'🚿',label:'D.fría',   type:'toggle'},
  {id:'walk',     emoji:'🚶',label:'Paseo',    type:'toggle'},
  {id:'reading',  emoji:'📖',label:'Leer',     type:'toggle'},
  {id:'breathing',emoji:'🌬️',label:'Respirar', type:'toggle'},
  {id:'protein',  emoji:'🥩',label:'Proteína', type:'toggle'},
  {id:'deficit',  emoji:'🥗',label:'Déficit',  type:'toggle'},
  {id:'agua',     emoji:'💧',label:'2.5L agua', type:'toggle'},
  {id:'sueño',    emoji:'😴',label:'8h sueño', type:'toggle'},
];
const PT=[
  {id:'normal', name:'Normal',   emoji:'💪',desc:'Posición clásica'},
  {id:'diamond',name:'Diamante', emoji:'💎',desc:'Manos en triángulo'},
  {id:'wide',   name:'Abierta',  emoji:'↔️',desc:'Manos separadas'},
  {id:'decline',name:'Declinada',emoji:'📐',desc:'Pies elevados'},
  {id:'incline',name:'Inclinada',emoji:'🔼',desc:'Manos elevadas'},
  {id:'archer', name:'Arquera',  emoji:'🏹',desc:'Alternando lados'},
  {id:'pike',   name:'Pike',     emoji:'⛰️',desc:'Cadera elevada'},
  {id:'spider', name:'Spiderman',emoji:'🕷️',desc:'Rodilla al codo'},
];
const RW={
  1:{title:'Sem 1–2 · Activación',duration:'25–30 min',rest:'45–60 s',exercises:[
    {id:'r1s',name:'Mini sentadilla 1 pierna',emoji:'🦵',sets:2,reps:'6',unit:'rep',perLeg:true},
    {id:'r1t',name:'Step-down bajo',emoji:'⬇️',sets:3,reps:'6',unit:'rep',perLeg:true},
    {id:'r1p',name:'Peso muerto 1 pierna',emoji:'🏋️',sets:3,reps:'8',unit:'rep',perLeg:true},
    {id:'r1l',name:'Desplazamientos laterales',emoji:'↔️',sets:3,reps:20,unit:'s',perLeg:false},
    {id:'r1j',name:'Saltos baja altura',emoji:'🦘',sets:3,reps:'8',unit:'rep',perLeg:false},
    {id:'r1e',name:'Equilibrio 1 pierna',emoji:'⚖️',sets:3,reps:30,unit:'s',perLeg:true},
  ]},
  2:{title:'Sem 3–4 · Volumen',duration:'30–35 min',rest:'45–60 s',exercises:[
    {id:'r2s',name:'Mini sentadilla 1 pierna',emoji:'🦵',sets:3,reps:'6',unit:'rep',perLeg:true},
    {id:'r2t',name:'Step-down medio',emoji:'⬇️',sets:3,reps:'8',unit:'rep',perLeg:true},
    {id:'r2p',name:'Peso muerto + mancuerna',emoji:'🏋️',sets:3,reps:'8',unit:'rep',perLeg:true},
    {id:'r2l',name:'Desplazamientos + banda',emoji:'↔️',sets:3,reps:25,unit:'s',perLeg:false},
    {id:'r2j',name:'Saltos moderados',emoji:'🦘',sets:3,reps:'8',unit:'rep',perLeg:false},
    {id:'r2e',name:'Equilibrio + mov. brazos',emoji:'⚖️',sets:3,reps:30,unit:'s',perLeg:true},
  ]},
  3:{title:'Sem 5–8 · Fútbol',duration:'35–40 min',rest:'60 s',exercises:[
    {id:'r3s',name:'Sentadilla 1 pierna completa',emoji:'🦵',sets:3,reps:'8',unit:'rep',perLeg:true},
    {id:'r3t',name:'Step-down con carga',emoji:'⬇️',sets:3,reps:'8',unit:'rep',perLeg:true},
    {id:'r3p',name:'Peso muerto + mancuerna',emoji:'🏋️',sets:3,reps:'8',unit:'rep',perLeg:true},
    {id:'r3l',name:'Desplazamientos + cambio sentido',emoji:'↔️',sets:3,reps:25,unit:'s',perLeg:false},
    {id:'r3j1',name:'Saltos adelante 0.5–1 m',emoji:'⏩',sets:3,reps:'6',unit:'rep',perLeg:false},
    {id:'r3j2',name:'Saltos laterales',emoji:'↕️',sets:3,reps:'6',unit:'rep',perLeg:true},
    {id:'r3e',name:'Equilibrio dinámico (conos)',emoji:'⚖️',sets:3,reps:30,unit:'s',perLeg:false},
  ]},
  4:{title:'Sem 9–12 · Alta Intensidad',duration:'40–45 min',rest:'60–90 s',exercises:[
    {id:'r4s',name:'Sentadilla 1 pierna + balón',emoji:'🦵',sets:3,reps:'8',unit:'rep',perLeg:true},
    {id:'r4t',name:'Step-down + recepción balón',emoji:'⬇️',sets:3,reps:'10',unit:'rep',perLeg:true},
    {id:'r4p',name:'Peso muerto + rotación',emoji:'🏋️',sets:3,reps:'8',unit:'rep',perLeg:true},
    {id:'r4j1',name:'Saltos + recepción balón',emoji:'⏩',sets:3,reps:'6',unit:'rep',perLeg:false},
    {id:'r4j2',name:'Saltos laterales + cambio dir.',emoji:'↕️',sets:3,reps:'6',unit:'rep',perLeg:true},
    {id:'r4sp',name:'Sprint reactivo 5–8 m',emoji:'💨',sets:1,reps:'6',unit:'rep',perLeg:false},
    {id:'r4l',name:'Desplazamientos + reacción balón',emoji:'⚽',sets:3,reps:25,unit:'s',perLeg:false},
  ]},
};
const HIPER=[
  {day:1,title:'Pecho + Tríceps',tag:'Push A',desc:'Pectorales cuadrados y volumen',groups:[
    {group:'🏋️ Pecho',color:'#5B6EF5',exercises:[
      {id:'h_bench',  name:'Press banca plano',          emoji:'🏋️',sets:4,reps:'8–10', desc:'Omóplatos retraídos · excéntrica 3s'},
      {id:'h_incline',name:'Press inclinado mancuernas', emoji:'📐',sets:4,reps:'10–12',desc:'Banco 30–45° · manos se juntan arriba'},
      {id:'h_fly',    name:'Aperturas en cable',         emoji:'🦋',sets:3,reps:'12–15',desc:'Codos semi-flexionados · cruzar al final'},
      {id:'h_dips',   name:'Fondos en paralelas',        emoji:'⬇️',sets:3,reps:'10–12',desc:'Inclinado hacia delante · lastrar al dominar'},
    ]},
    {group:'🦾 Tríceps',color:'#8B5CF6',exercises:[
      {id:'h_tri',    name:'Extensión tríceps en polea', emoji:'🔽',sets:3,reps:'12–15',desc:'Cuerda · codos pegados · extensión completa'},
    ]},
  ]},
  {day:2,title:'Espalda + Bíceps',tag:'Pull',desc:'Amplitud dorsal y forma de V',groups:[
    {group:'🔝 Espalda',color:'#06B6D4',exercises:[
      {id:'h_pullup', name:'Dominadas agarre prono',     emoji:'⬆️',sets:4,reps:'6–10', desc:'Agarre amplio · pecho a la barra · lastrar al dominar'},
      {id:'h_row',    name:'Remo con barra Pendlay',     emoji:'🏋️',sets:4,reps:'8–10', desc:'Espalda paralela · barra muerta entre reps'},
      {id:'h_cable',  name:'Remo en polea baja',         emoji:'📦',sets:3,reps:'10–12',desc:'Sentado · retracción escapular primero'},
      {id:'h_lat',    name:'Jalón al pecho',             emoji:'⬇️',sets:3,reps:'10–12',desc:'Agarre amplio · llevar a clavículas'},
    ]},
    {group:'💪 Bíceps',color:'#22C55E',exercises:[
      {id:'h_curl',   name:'Curl de bíceps con barra',  emoji:'💪',sets:3,reps:'10–12',desc:'Codos fijos · sin balanceo · supinación completa'},
      {id:'h_hammer', name:'Curl martillo mancuernas',  emoji:'🔨',sets:3,reps:'12',   desc:'Agarre neutro · braquial y braquiorradial'},
    ]},
  ]},
  {day:3,title:'Hombros + Core',tag:'V-Shape',desc:'El día clave de la V · Deltoides y abdomen',groups:[
    {group:'🎯 Hombros',color:'#F97316',exercises:[
      {id:'h_press',  name:'Press militar con barra',    emoji:'🏋️',sets:4,reps:'8–10', desc:'De pie · core activo · sin hiperextender lumbar'},
      {id:'h_lateral',name:'Elevaciones laterales',      emoji:'↔️',sets:4,reps:'12–15',desc:'Excéntrica 3s · dedo meñique arriba · peso ligero y perfecto'},
      {id:'h_rear',   name:'Pájaro deltoides posterior', emoji:'🦅',sets:3,reps:'12–15',desc:'Tronco inclinado · arco amplio · retracción escapular'},
    ]},
    {group:'🔥 Core',color:'#EF4444',exercises:[
      {id:'h_wheel',  name:'Ab Wheel Rollout',           emoji:'⚙️',sets:4,reps:'8–12', desc:'Desde rodillas · sin colapsar lumbar · confirmar con fisio'},
      {id:'h_legr',   name:'Elevación piernas tumbado',  emoji:'🦵',sets:3,reps:'12–15',desc:'Manos bajo glúteos · sin tocar el suelo · confirmar con fisio'},
      {id:'h_twist',  name:'Rotación rusa con disco',    emoji:'🔄',sets:3,reps:'20',   desc:'Sentado 45° · pies en suelo · rotar a ambos lados'},
    ]},
  ]},
  {day:4,title:'Core + Brazos',tag:'Detalle',desc:'Oblicuos y definición de brazos',groups:[
    {group:'🔥 Core avanzado',color:'#EF4444',exercises:[
      {id:'h_plank2', name:'Plancha + elevación alterna', emoji:'🧱',sets:3,reps:40, unit:'s',desc:'3s por posición · sin rotar cadera'},
      {id:'h_crunch', name:'Crunch en cable (rodillas)',  emoji:'💥',sets:3,reps:'15',    desc:'Solo abdomen · no usar brazos'},
      {id:'h_chop',   name:'Wood Chop en cable',          emoji:'🪓',sets:3,reps:'12',perLeg:true,desc:'Diagonal hombro–cadera · pies fijos'},
      {id:'h_side',   name:'Plancha lateral',             emoji:'📐',sets:3,reps:40, unit:'s',perLeg:true,desc:'Cadera elevada · línea recta · modificar si duele rodilla'},
    ]},
    {group:'💪 Brazos aislamiento',color:'#8B5CF6',exercises:[
      {id:'h_incurl', name:'Curl banco inclinado',              emoji:'💪',sets:3,reps:'10–12',desc:'45° · extensión total · tensión constante'},
      {id:'h_tri2',   name:'Extensión tríceps sobre la cabeza', emoji:'🦾',sets:3,reps:'10–12',desc:'Estira porción larga del tríceps'},
    ]},
  ]},
];
let hiperDay=1;

// ══ STATE ═════════════════════════════════════════════════
const DS=()=>({
  tab:'home',rehabWeek:1,date:td(),weekStart:ws(),
  xp:0,rehabXp:0,streak:0,rehabDaysTotal:0,rehabDaysThisWeek:0,
  pushups:{},legs:{},general:{},
  habits:{cold:false,walk:false,reading:false,breathing:false,protein:false,deficit:false,agua:false,sueño:false},
  earned:[],weeklyEarned:[],
  habitXpToday:false,pushXpAwarded:0,rehabXpToday:0,_decayMsg:null,
  xpToday:0,
  history:{},
  profile:{name:'',rehabDaysGoal:4,reminderTime:'19:00',reminderEnabled:false,onboardingDone:false},
  training:{weights:{},prs:{}},
  habitSettings:{},
  recomp:{
    entries:{},
    measures:{},
    goal:{targetWeight:85,targetBF:11,startWeight:92,startBF:16,startDate:null},
    xpToday:false
  }
});
let state=DS();
function td(){return new Date().toISOString().slice(0,10)}
function ws(){const d=new Date(),day=d.getDay(),diff=d.getDate()-(day===0?6:day-1);return new Date(new Date().setDate(diff)).toISOString().slice(0,10)}
function dBetween(a,b){return Math.round((new Date(b)-new Date(a))/864e5)}
function tPush(s){return Object.values(((s||state).pushups)||{}).flat().reduce((n,x)=>n+(x.reps||0),0)}


// ══ GOOGLE LOGIN ══════════════════════════════════════════════
async function doGoogleLogin(){
  liErr('');
  const provider=new firebase.auth.GoogleAuthProvider();
  try{
    appLoaded=false;
    const cur=auth.currentUser;
    if(cur&&cur.isAnonymous){
      // Invitado → enlaza la cuenta Google conservando los datos del invitado
      try{
        await cur.linkWithPopup(provider);
      }catch(ex){
        if(ex.code==='auth/credential-already-in-use'||ex.code==='auth/email-already-in-use'){
          // Esa cuenta Google ya existe → inicia sesión normal en ella
          await auth.signInWithPopup(provider);
        } else throw ex;
      }
    } else {
      await auth.signInWithPopup(provider);
    }
    // onAuthStateChanged se encarga de cargar datos y mostrar la app
  }catch(ex){
    appLoaded=true;
    liErr(ex.code==='auth/popup-closed-by-user'?'Ventana cerrada':ex.code==='auth/unauthorized-domain'?'Dominio no autorizado en Firebase':'Error Google: '+ex.message);
  }
}

// ══ AUTH ══════════════════════════════════════════════════
let appLoaded = false; // flag: solo carga datos la PRIMERA vez

auth.onAuthStateChanged(async u=>{
  currentUser = u;

  if(appLoaded){
    // Token refresh o re-auth posterior — NO recargar datos
    return;
  }
  appLoaded = true;

  if(u){
    // Usuario con sesión (Google, email o anónimo) → carga de la nube
    await loadFS();
  } else {
    loadLocal();
  }

  document.getElementById('loadingScreen').classList.add('hidden');
  if(!u){
    // Sin sesión → pantalla de acceso
    document.getElementById('loginScreen').classList.remove('hidden');
  } else {
    showApp();
  }
});

function liErr(m){document.getElementById('liErr').textContent=m}
async function doLogin(){
  const e=document.getElementById('liEmail').value.trim(),p=document.getElementById('liPass').value;
  liErr('');if(!e||!p){liErr('Rellena todos los campos');return}
  try{
    appLoaded = false; // permite re-inicializar con los datos del usuario
    await auth.signInWithEmailAndPassword(e,p);
    // NO llamamos showApp() aquí — onAuthStateChanged lo hace
  }
  catch(ex){liErr(ex.code==='auth/wrong-password'?'Contraseña incorrecta':ex.code==='auth/user-not-found'?'Usuario no encontrado':ex.code==='auth/invalid-email'?'Email inválido':'Error: '+ex.message)}
}
async function doPasswordReset(){
  const e=document.getElementById('liEmail').value.trim();
  liErr('');
  if(!e){liErr('Introduce tu email primero');return}
  if(!auth||typeof auth.sendPasswordResetEmail!=='function'){liErr('Recuperación no disponible ahora mismo');return}
  try{
    await auth.sendPasswordResetEmail(e);
    liErr('Si el email existe, recibirás un enlace de recuperación');
  }catch(ex){
    if(ex.code==='auth/invalid-email')liErr('Email inválido');
    else if(ex.code==='auth/network-request-failed')liErr('Sin conexión. Inténtalo de nuevo en un momento');
    else liErr('No se pudo enviar el email ahora mismo');
  }
}
async function doRegister(){
  const e=document.getElementById('liEmail').value.trim(),p=document.getElementById('liPass').value;
  liErr('');if(!e||!p){liErr('Rellena todos los campos');return}if(p.length<6){liErr('Mínimo 6 caracteres');return}
  try{
    appLoaded = false;
    await auth.createUserWithEmailAndPassword(e,p);
    // NO llamamos showApp() aquí — onAuthStateChanged lo hace
  }
  catch(ex){liErr(ex.code==='auth/email-already-in-use'?'Email ya registrado':'Error: '+ex.message)}
}
async function doGuest(){
  liErr('');
  try{
    appLoaded=false;
    await auth.signInAnonymously();
    // onAuthStateChanged carga datos (de la nube anónima) y muestra la app
  }catch(ex){
    // Proveedor anónimo deshabilitado o sin red → modo local puro
    appLoaded=true;currentUser=null;
    document.getElementById('loginScreen').classList.add('hidden');
    loadLocal();showApp();
  }
}
function showApp(){
  document.getElementById('loginScreen').classList.add('hidden');
  const _ma=document.getElementById('mainApp');if(_ma)_ma.style.display='block';
  checkDailyReminder();
  renderAll();
}
async function doLogout(){
  closeModal('logoutModal');
  flushSave(); // guarda inmediatamente antes de salir
  await auth.signOut();
  appLoaded = false;
  state=DS();
  const _ma2=document.getElementById('mainApp');if(_ma2)_ma2.style.display='none';
  document.getElementById('loginScreen').classList.remove('hidden');
}

// ══ PERSISTENCE ═══════════════════════════════════════════

// Firestore a veces convierte arrays en objetos {"0":true,"1":false}
// Esta función los restaura a arrays limpios
function sanitize(s){
  // Convierte objeto-falso-array → array real
  function fixArr(val){
    if(Array.isArray(val)) return val;
    if(val && typeof val==='object'){
      // ¿Es un objeto con claves numéricas? → convertir a array
      const keys=Object.keys(val);
      if(keys.length===0) return [];
      if(keys.every(k=>!isNaN(k))){
        const max=Math.max(...keys.map(Number));
        const arr=[];
        for(let i=0;i<=max;i++) arr.push(val[i]===undefined?false:val[i]);
        return arr;
      }
    }
    return [];
  }
  // Arregla pushups: {typeId: [{reps,done,xpAwarded}]}
  if(s.pushups && typeof s.pushups==='object'){
    for(const k of Object.keys(s.pushups)){
      const fixed=fixArr(s.pushups[k]);
      s.pushups[k]=fixed.map(item=>{
        if(item && typeof item==='object') return {reps:item.reps||0, done:!!item.done, xpAwarded:item.xpAwarded||0};
        return {reps:0,done:false,xpAwarded:0};
      });
    }
  }
  // Arregla legs, general: {exId: [bool]}
  for(const field of ['legs','general']){
    if(s[field] && typeof s[field]==='object'){
      for(const k of Object.keys(s[field])){
        s[field][k]=fixArr(s[field][k]).map(v=>!!v);
      }
    }
  }
  // Arregla earned, weeklyEarned: [string]
  s.earned     = fixArr(s.earned).filter(v=>typeof v==='string');
  s.weeklyEarned = fixArr(s.weeklyEarned).filter(v=>typeof v==='string');
  // Arregla hábitos (a veces los booleans llegan como 0/1 de Firestore)
  if(s.habits){
    for(const k of Object.keys(s.habits)){
      if(false) s.habits[k]=parseInt(s.habits[k])||0; // no counter habits
      else s.habits[k]=!!s.habits[k];
    }
  }
  return s;
}

async function loadFS(){
  try{
    const doc=await db.collection('users').doc(currentUser.uid).collection('data').doc('state').get();
    if(doc.exists) state=sanitize({...DS(),...doc.data()});
  }catch(e){console.warn('[MAXER] No se pudo cargar Firestore; usando localStorage.',e);loadLocal()}
  processLoad();
}
function loadLocal(){
  try{const r=localStorage.getItem('maxer_v1');if(r) state=sanitize({...DS(),...JSON.parse(r)})}catch(e){}
  processLoad();
}
function processLoad(){
  const d=td(),w=ws();
  if(state.weekStart!==w){state.weeklyEarned=[];state.weekStart=w;state.rehabDaysThisWeek=0}
  if(state.date&&state.date!==d){
    const missed=Math.max(0,dBetween(state.date,d)-1);
    if(missed>0){
      const decay=Math.pow(0.88,missed),lost=Math.round((state.rehabXp||0)*(1-decay));
      state.rehabXp=Math.round((state.rehabXp||0)*decay);state.xp=Math.max(0,state.xp-lost);
      if(lost>0) state._decayMsg='📉 Perdiste '+lost+' XP de rehab ('+missed+' día'+(missed>1?'s':'')+' sin entrenar)';
      if(dBetween(state.date,d)>1) state.streak=0;
    }
    const hp=Object.values(state.pushups||{}).some(s=>s.length>0);
    const hl=Object.values(state.legs||{}).some(a=>a.some(Boolean));
    if(hp||hl) setTimeout(()=>document.getElementById('newDayModal').classList.remove('hidden'),600);
    else startNewDay();
  }
}
function saveState(){
  state.date=td();
  const p=JSON.parse(JSON.stringify(state));
  localStorage.setItem('maxer_v1',JSON.stringify(p));
  if(currentUser){
    clearTimeout(saveTimer);
    // Guarda el snapshot AHORA en el closure, no "state" 400ms después
    saveTimer=setTimeout(()=>fsWrite(p), 400);
  }
}
function fsWrite(data){
  if(!currentUser) return;
  db.collection('users').doc(currentUser.uid).collection('data').doc('state').set(data).catch(e=>console.warn('[MAXER] Error sincronizando Firestore.',e));
}
function flushSave(){
  // Escribe inmediatamente (ej: antes de logout o cerrar tab)
  clearTimeout(saveTimer);
  fsWrite(JSON.parse(JSON.stringify(state)));
}
// Guarda antes de cerrar la pestaña
window.addEventListener('beforeunload', ()=>{ if(currentUser) flushSave(); });

// ══ XP ════════════════════════════════════════════════════
function lvl(x){for(let i=LEVELS.length-1;i>=0;i--) if(x>=LEVELS[i].min) return{...LEVELS[i],idx:i};return{...LEVELS[0],idx:0}}
function awardXP(n,label,isRehab){state.xp+=n;state.xpToday=(state.xpToday||0)+n;if(isRehab) state.rehabXp=(state.rehabXp||0)+n;saveState();updateHeader();showXPPop('+'+n+' XP'+(label?' · '+label:''));checkAch()}
function deductXP(n,isRehab){state.xp=Math.max(0,state.xp-n);if(isRehab) state.rehabXp=Math.max(0,(state.rehabXp||0)-n);updateHeader()}
function showXPPop(m){const el=document.createElement('div');el.className='xp-pop';el.textContent=m;document.body.appendChild(el);setTimeout(()=>el.remove(),1600)}
function checkAch(){let ch=false;for(const a of ACH){const l=a.weekly?state.weeklyEarned:state.earned;if(!l.includes(a.id)&&a.check(state)){l.push(a.id);ch=true;setTimeout(()=>showXPPop('🏆 '+a.name),600)}}if(ch) saveState()}
function updateHeader(){
  document.getElementById('hXP').textContent=state.xp;
  document.getElementById('hStreak').textContent=state.streak;
  const lv=lvl(state.xp),pct=Math.min(((state.xp-lv.min)/(lv.max-lv.min))*100,100);
  document.getElementById('levelName').textContent='Nivel '+(lv.idx+1)+' · '+lv.name;
  document.getElementById('levelXP').textContent=state.xp+'/'+lv.max+' XP';
  document.getElementById('levelBarFill').style.width=pct+'%';
  const bar=document.querySelector('.level-bar-wrap');
  if(bar)bar.setAttribute('aria-valuenow',String(Math.round(pct)));
}

// ══ TIMER ════════════════════════════════════════════════
let tInt=null,tTotal=0,tLeft=0,tCb=null;
const CIRC=502;
function startTimer(secs,label,cb){
  tTotal=secs;tLeft=secs;tCb=cb;
  document.getElementById('timerExName').textContent=label;updTimer();
  document.getElementById('timerOverlay').classList.remove('hidden');
  clearInterval(tInt);tInt=setInterval(()=>{tLeft--;updTimer();if(tLeft<=0){clearInterval(tInt);if(navigator.vibrate) navigator.vibrate([100,50,100]);setTimeout(()=>{document.getElementById('timerOverlay').classList.add('hidden');if(tCb) tCb()},600)}},1000)
}
function updTimer(){document.getElementById('timerCircle').style.strokeDashoffset=CIRC-CIRC*(tLeft/tTotal);document.getElementById('timerSecs').textContent=tLeft}
function skipTimer(){clearInterval(tInt);document.getElementById('timerOverlay').classList.add('hidden');if(tCb) tCb()}
let rInt=null;
function startRest(s){stopRest();let l=s;document.getElementById('restSecs').textContent=l;document.getElementById('restBarFill').style.width='100%';document.getElementById('restToast').classList.remove('hidden');rInt=setInterval(()=>{l--;document.getElementById('restSecs').textContent=l;document.getElementById('restBarFill').style.width=(l/s*100)+'%';if(l<=0){stopRest();if(navigator.vibrate) navigator.vibrate(200)}},1000)}
function stopRest(){clearInterval(rInt);document.getElementById('restToast').classList.add('hidden')}

// ══ MODALS & RESET ════════════════════════════════════════
function closeModal(id){
  if(id){document.getElementById(id)?.classList.add('hidden');return;}
  document.querySelectorAll('.modal-overlay').forEach(m=>m.classList.add('hidden'));
}
function startNewDay(){
  // Archive today's stats before resetting
  const y=state.date;
  if(y){
    if(!state.history) state.history={};
    state.history[y]={xp:state.xpToday||0,pushups:tPush(),rehabDone:(state.rehabXpToday||0)>0};
    // Keep only last 60 days
    const keys=Object.keys(state.history).sort();
    while(keys.length>60) delete state.history[keys.shift()];
  }
  state.pushups={};state.legs={};state.general={};
  state.habits={cold:false,walk:false,reading:false,breathing:false,protein:false,deficit:false,agua:false,sueño:false};
  state.habitXpToday=false;state.pushXpAwarded=0;state.rehabXpToday=0;state._decayMsg=null;state.xpToday=0;if(state.recomp)state.recomp.xpToday=false;
  state.date=td();state.streak=(state.streak||0)+1;
}
function confirmNewDay(){closeModal('newDayModal');startNewDay();saveState();renderAll()}
function confirmReset(){confirmNewDay()}
function promptDayReset(){if(confirm('¿Resetear solo el día de hoy?')){startNewDay();saveState();renderAll()}}
function doFullReset(){
  closeModal('fullResetModal');state=DS();saveState();renderAll();
  if(currentUser) db.collection('users').doc(currentUser.uid).collection('data').doc('state').set(DS()).catch(e=>console.warn('[MAXER] Error reiniciando Firestore.',e));
}

// ══ TABS ══════════════════════════════════════════════════
function switchTab(t){
  state.tab=t;
  ['home','rehab','training','progress'].forEach(id=>{
    const nav=document.getElementById('nav'+id.charAt(0).toUpperCase()+id.slice(1));
    if(nav) nav.className='nav-btn'+(t===id?' active':'');
  });
  const settingsBtn=document.getElementById('settingsBtn');
  if(settingsBtn) settingsBtn.className='settings-btn'+(t==='settings'?' active':'');
  render();
}

// ══ HABITS ═══════════════════════════════════════════════
function renderHabits(){
  ensureUnifiedState();
  const visible=HABITS.filter(h=>state.habitSettings[h.id]!==false);
  document.getElementById('habitsRow').innerHTML=visible.map(h=>{
    if(h.type==='counter'){const v=state.habits[h.id]||0,done=v>=h.max;
      return `<div class="habit-chip${done?' done':''}" role="checkbox" tabindex="0" aria-checked="${done?'true':'false'}" aria-label="${esc(h.label)} ${v} de ${h.max}" onclick="toggleHabit('${h.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleHabit('${h.id}')}"><span class="habit-emoji">${h.emoji}</span><span class="water-count">${v}/${h.max}</span><span class="habit-label">${h.label}</span></div>`}
    const done=!!state.habits[h.id];
    return `<div class="habit-chip${done?' done':''}" role="checkbox" tabindex="0" aria-checked="${done?'true':'false'}" aria-label="${esc(h.label)} ${done?'hecho':'pendiente'}" onclick="toggleHabit('${h.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleHabit('${h.id}')}"><span class="habit-emoji">${done?'✅':h.emoji}</span><span class="habit-label">${h.label}</span></div>`
  }).join('')
}
function getLbls(ex){const l=[];for(let i=0;i<ex.sets;i++){if(ex.perLeg){l.push('S'+(i+1)+'I');l.push('S'+(i+1)+'D')}else l.push('S'+(i+1))}return l}
function swRW(w){state.rehabWeek=w;state.legs={};saveState();render()}

const REHAB_WARMUP=[
  {emoji:'⭕',name:'Círculos de tobillo',detail:'30s c/lado · lento y controlado'},
  {emoji:'🦵',name:'Activación cuádriceps',detail:'20 contracciones isométricas · sentado'},
  {emoji:'🔄',name:'Movilidad de cadera',detail:'10 reps c/lado · sin dolor'},
  {emoji:'🧘',name:'Estiramiento pantorrilla',detail:'30s c/pierna · pared · suave'},
];
const REHAB_TIPS={
  1:'Fase de activación: no hay "poco". La consistencia importa más que la intensidad. Dolor = parar.',
  2:'Fase de volumen: el cuádriceps y el glúteo están aprendiendo a cooperar. Excéntrica lenta = más ganancia.',
  3:'Fase fútbol: los cambios de dirección son el corazón de esta fase. Prioriza el control antes de la velocidad.',
  4:'Fase intensidad: ya estás cerca del deporte real. Confirma cada ejercicio de suelo con tu fisio.',
};
function rRehab(){
  if(state.profile?.rehabEnabled===false){
    return `<div class="sec-head"><div class="sec-title">Rehab desactivada</div><div class="sec-sub">MAXER conserva tus datos. Puedes activarla cuando quieras.</div></div><div class="settings-card"><div class="settings-card-title">Sin rehab por ahora</div><div class="settings-help">La app sigue funcionando con diario, hábitos, entrenos, mínimos y progreso.</div><button class="settings-action primary" style="width:100%;margin-top:10px" onclick="toggleRehabEnabled(true)">Activar rehab</button></div>`;
  }
  const wk=RW[state.rehabWeek],exs=wk.exercises;
  const tot=exs.reduce((s,e)=>s+(e.perLeg?e.sets*2:e.sets),0);
  const done=exs.reduce((s,e)=>s+((state.legs[e.id]||[]).filter(Boolean).length),0);
  const pct=tot>0?Math.round(done/tot*100):0;
  const dtw=state.rehabDaysThisWeek||0;
  const totalDays=state.rehabDaysTotal||0;
  const wrbDots=Array.from({length:4},(_,i)=>{const d=i<dtw;return'<div class="wrb-dot'+(d?(i===3?' bonus':' done'):(i===2?' target':''))+'"></div>'}).join('');

  let h=`<div class="sec-head"><div class="sec-title">🦵 Rehab ACL</div><div class="sec-sub">Día ${totalDays}/90 · Serie = <span>+2 XP</span> · Día completo = <span>+30 XP</span></div></div>`;

  // Phase selector
  h+='<div class="week-bar">'+[
    {l:'Act',s:'S1–2',w:1},{l:'Vol',s:'S3–4',w:2},{l:'Fútbol',s:'S5–8',w:3},{l:'Alta Int.',s:'S9–12',w:4}
  ].map(({l,s,w})=>`<button class="week-btn${state.rehabWeek===w?' active':''}" onclick="swRW(${w})"><span>${s}</span>${l}</button>`).join('')+'</div>';

  // Phase badge + tip
  h+=`<div style="margin-bottom:10px"><span class="rehab-phase-badge">${wk.title}</span></div>`;
  h+=`<div class="rehab-tip"><span>💡</span><span>${REHAB_TIPS[state.rehabWeek]}</span></div>`;

  // Duration + rest info
  h+=`<div class="info-box">⏱ ${wk.duration} · Descanso entre series: ${wk.rest}</div>`;

  // Weekly progress bar
  h+=`<div class="week-rehab-bar" style="margin-bottom:11px"><div class="wrb-header"><div class="wrb-title">🗓 Esta semana</div><div class="wrb-badge ${dtw>=3?'goal':''}">${dtw}/3 días ${dtw>=4?'🔥 Bonus':dtw>=3?'✅':'· meta: 3–4'}</div></div><div class="wrb-dots">${wrbDots}</div><div class="wrb-labels"><span>L</span><span>M</span><span>X</span><span>J</span></div></div>`;

  // Session progress bar
  h+=`<div style="background:var(--surface);border-radius:12px;padding:12px 14px;border:1px solid var(--border);margin-bottom:12px;box-shadow:var(--sh)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px"><span style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:1px;text-transform:uppercase">Sesión de hoy</span><span style="font-size:14px;font-weight:800;font-family:'JetBrains Mono',monospace;color:var(--blue)">${done}/${tot} series · ${pct}%</span></div><div style="height:6px;background:var(--bg);border-radius:6px;overflow:hidden"><div style="height:100%;border-radius:6px;background:linear-gradient(90deg,var(--green),#16a34a);transition:width .5s ease;width:${pct}%"></div></div></div>`;

  // Warmup accordion
  h+=`<div class="rehab-warmup"><div class="rehab-warmup-title">🔥 Calentamiento previo (5 min)</div><div class="warmup-list">${REHAB_WARMUP.map(w=>`<div class="warmup-item"><span class="warmup-item-emoji">${w.emoji}</span><span><strong>${w.name}</strong> · ${w.detail}</span></div>`).join('')}</div></div>`;

  // Exercises
  for(const ex of exs){
    const ts=ex.perLeg?ex.sets*2:ex.sets,lbls=getLbls(ex),ed=(state.legs[ex.id]||[]).filter(Boolean).length,all=ed===ts;
    const es=JSON.stringify(ex).replace(/"/g,'&quot;');
    h+=`<div class="card${all?' completed':''}"><div class="card-head"><div class="card-info"><span class="card-emoji">${ex.emoji}</span><div><div class="card-name">${ex.name}</div><div class="card-desc">${ex.sets} series × ${ex.reps} ${ex.unit}${ex.perLeg?' · c/pierna':''}</div></div></div><div class="card-badge">${ed}/${ts}</div></div>`+
    `<div class="sets-grid">${lbls.map((l,i)=>{const isDone=(state.legs[ex.id]||[])[i];return`<button class="set-btn${isDone?' done':''}" aria-pressed="${isDone?'true':'false'}" onclick="togRehab('${ex.id}',${i},${es})">${isDone?'✓':'○'} ${l}${ex.unit==='s'?' ⏱':''}</button>`}).join('')}</div></div>`;
  }

  // Cooldown note
  h+=`<div class="info-box" style="margin-top:4px">🧊 Al terminar: 5 min de hielo si hay inflamación · estiramiento suave de cuádriceps e isquios</div>`;

  if(done===tot&&tot>0) h+=`<div class="complete-banner">🦵 ¡Sesión completada! +30 XP · Día ${totalDays} de 90</div>`;
  return h;
}

function rGen(){
  ensureUnifiedState();
  const day=HIPER[hiperDay-1];
  const allExs=day.groups.flatMap(g=>g.exercises);
  const totalSets=allExs.reduce((s,ex)=>s+(ex.perLeg?ex.sets*2:ex.sets),0);
  const doneSets=allExs.reduce((s,ex)=>s+((state.general[ex.id]||[]).filter(Boolean).length),0);
  const pct=totalSets>0?Math.round(doneSets/totalSets*100):0;

  let dayBtns=HIPER.map(d=>{
    const de=d.groups.flatMap(g=>g.exercises);
    const dt=de.reduce((s,ex)=>s+(ex.perLeg?ex.sets*2:ex.sets),0);
    const dd=de.reduce((s,ex)=>s+((state.general[ex.id]||[]).filter(Boolean).length),0);
    const complete=dt>0&&dd===dt;
    return `<button class="week-btn${hiperDay===d.day?' active':''}" onclick="hiperDay=${d.day};render()">`+
      `<span>${d.tag}</span>${complete?'✓ ':''}${d.title.split(' + ')[0]}</button>`;
  }).join('');

  let h=`<div class="sec-head"><div class="sec-title">Entrenamiento</div>`+
    `<div class="sec-sub">+2 XP por serie · ⏱ = cronómetro · guarda tu peso para ver PRs</div></div>`+
    `<div class="week-bar">${dayBtns}</div>`+
    `<div class="info-box">📌 <strong>${day.title}</strong> · ${day.tag} — ${day.desc}</div>`;

  if(day.day===3||day.day===4)
    h+=`<div class="info-box">⚠️ ACL: confirma con tu fisio ejercicios de suelo antes de hacerlos.</div>`;

  h+=`<div style="background:var(--surface);border-radius:12px;padding:12px 14px;border:1px solid var(--border);margin-bottom:12px;box-shadow:var(--sh)">`+
     `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px">`+
     `<span style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:1px;text-transform:uppercase">Progreso</span>`+
     `<span style="font-size:14px;font-weight:800;font-family:'JetBrains Mono',monospace;color:var(--text)">${doneSets}/${totalSets} series</span></div>`+
     `<div style="height:6px;background:var(--bg);border-radius:6px;overflow:hidden"><div style="height:100%;border-radius:6px;background:var(--text);transition:width .5s ease;width:${pct}%"></div></div></div>`;

  for(const g of day.groups){
    h+=`<div class="exercise-group"><div class="group-title">${g.group}</div>`;
    for(const ex of g.exercises){
      const ts=ex.perLeg?ex.sets*2:ex.sets;
      const lbls=[];
      for(let i=0;i<ex.sets;i++){
        if(ex.perLeg){lbls.push('S'+(i+1)+'I');lbls.push('S'+(i+1)+'D')}
        else lbls.push('S'+(i+1));
      }
      const ed=(state.general[ex.id]||[]).filter(Boolean).length,all=ed===ts;
      const es=JSON.stringify(ex).replace(/"/g,'&quot;');
      const repLabel=ex.unit==='s'?ex.reps+'s':ex.reps+' reps';
      const isWeighted=ex.unit!=='s';
      const kg=(state.training.weights||{})[ex.id]||'';
      const pr=(state.training.prs||{})[ex.id];
      h+=`<div class="card${all?' completed':''}">
        <div class="card-head">
          <div class="card-info">
            <span class="card-emoji">${ex.emoji}</span>
            <div>
              <div class="card-name">${ex.name}</div>
              <div class="card-desc">${ex.sets}×${repLabel}${ex.perLeg?' c/lado':''} · ${ex.desc}</div>
            </div>
          </div>
          <div class="card-badge">${ed}/${ts}</div>
        </div>
        ${isWeighted?`<div class="kg-row">
          <span class="kg-label">Peso</span>
          <input class="kg-input" type="number" inputmode="decimal" step="2.5" min="0" value="${kg}" placeholder="0" oninput="setTrainingWeight('${ex.id}',this.value)">
          <span class="kg-unit">kg</span>
          <span class="pr-badge${!pr?' empty':''}">${pr?'PR '+pr.kg+'kg×'+pr.reps:'Sin PR'}</span>
        </div>`:''}
        <div class="sets-grid">
          ${lbls.map((l,i)=>{
            const isDone=(state.general[ex.id]||[])[i];
            return `<button class="set-btn${isDone?' done':''}" aria-pressed="${isDone?'true':'false'}" onclick="togGen('${ex.id}',${i},${es})">${isDone?'✓':'○'} ${l}${ex.unit==='s'?' ⏱':''}</button>`;
          }).join('')}
        </div>
      </div>`;
    }
    h+='</div>';
  }

  if(doneSets===totalSets&&totalSets>0)
    h+=`<div class="complete-banner">💪 ¡${day.title} completado!</div>`;

  return h;
}

if(document.getElementById('liPass')){
  document.getElementById('liPass').addEventListener('keydown',e=>{if(e.key==='Enter') doLogin()});
}

// ══ DAILY REMINDER (legacy, sobrescrito más abajo) ═════════
function checkDailyReminder(){
  if(!state.profile?.reminderEnabled||!state.profile?.reminderTime) return;
  if('Notification' in window && Notification.permission==='granted'){
    const [hh,mm]=state.profile.reminderTime.split(':').map(Number);
    const now=new Date(),target=new Date();
    target.setHours(hh,mm,0,0);
    if(target<=now) target.setDate(target.getDate()+1);
    const ms=target-now;
    // Only schedule if less than 24h away (tab still open scenario)
    if(ms<864e5){
      setTimeout(()=>{
        // Only notify if they haven't trained today
        const noActivity=tPush()===0&&Object.values(state.legs).every(a=>a.every(v=>!v));
        if(noActivity) new Notification('MAXER 💪',{body:'¡'+( state.profile?.name||'A entrenar')+'! Hora de mantener la racha 🔥',icon:'/icon-192.png'});
      },ms);
    }
  }
}

// ══ STATS CHARTS ══════════════════════════════════════════
function updProfileField(key,value){
  if(!state.profile) state.profile={};
  state.profile[key]=value;
  saveState();
  updateHeader();
}
function updProfileName(value){updProfileField('name',(value||'').trim())}
function updRehabGoal(value){updProfileField('rehabDaysGoal',parseInt(value)||4);render()}
function toggleRehabEnabled(value){updProfileField('rehabEnabled',value===undefined?!state.profile?.rehabEnabled:!!value);renderAll()}
function updReminderTime(value){updProfileField('reminderTime',value||'19:00');checkDailyReminder()}
async function toggleReminder(){
  if(!state.profile) state.profile={};
  const next=!state.profile.reminderEnabled;
  if(next){
    if(!('Notification' in window)){alert('Este navegador no permite notificaciones.');return;}
    const perm=Notification.permission==='granted'?'granted':await Notification.requestPermission().catch(()=>'denied');
    if(perm!=='granted'){alert('No se han concedido permisos de notificación.');return;}
  }
  state.profile.reminderEnabled=next;
  saveState();
  checkDailyReminder();
  render();
}
let statsMonth=null;
function changeStatsMonth(delta){
  ensureUnifiedState();
  const now=new Date();
  if(!statsMonth)statsMonth={y:now.getFullYear(),m:now.getMonth()};
  let m=statsMonth.m+delta,y=statsMonth.y;
  if(m<0){m=11;y--}if(m>11){m=0;y++}
  if(y>now.getFullYear()||(y===now.getFullYear()&&m>now.getMonth()))return; // no avanzar al futuro
  statsMonth={y,m};render();
}
function rStats(){
  const name=state.profile?.name||'';
  const hist=state.history||{};

  // Semana actual: lunes → domingo
  const base=new Date();
  const dow=base.getDay()===0?7:base.getDay(); // 1=Lun .. 7=Dom
  const monday=new Date();monday.setDate(base.getDate()-(dow-1));
  const WD=['L','M','X','J','V','S','D'];
  const days=[];
  for(let i=0;i<7;i++){
    const d=new Date(monday);d.setDate(monday.getDate()+i);
    const key=d.toISOString().slice(0,10);
    const isToday=key===td();
    const entry=hist[key]||null;
    days.push({key,label:WD[i],isToday,xp:isToday?(state.xpToday||0):(entry?.xp||0)});
  }

  // Gráfico de barras XP (muestra el número de XP encima de cada barra)
  function barChart(data,maxVal,colorFrom,colorTo){
    const W=320,H=80,barW=32,gap=(W-barW*7)/6;
    let svgBars='',svgVals='';
    data.forEach((d,i)=>{
      const x=i*(barW+gap);
      const pct=maxVal>0?d/maxVal:0;
      const bh=Math.max(pct*H,d>0?4:0);
      const by=H-bh;
      svgBars+=`<defs><linearGradient id="bg${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${colorFrom}"/><stop offset="100%" stop-color="${colorTo}"/></linearGradient></defs>`;
      svgBars+=`<rect x="${x}" y="${by}" width="${barW}" height="${bh}" rx="6" fill="${d>0?'url(#bg'+i+')':'#E4E8F5'}"/>`;
      svgVals+=`<text x="${x+barW/2}" y="${d>0?by-4:H-4}" text-anchor="middle" font-size="9" font-weight="700" fill="${d>0?colorFrom:'#cbd5e1'}" font-family="JetBrains Mono,monospace">${d}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H+16}" width="100%" style="overflow:visible">${svgBars}${svgVals}</svg>`;
  }

  const xpVals=days.map(d=>d.xp);
  const maxXP=Math.max(...xpVals,1);
  const labelHtml=days.map(d=>`<span class="bar-label${d.isToday?' today':''}">${d.label}${d.isToday?'*':''}</span>`).join('');

  // Calendario de rehab con navegación de meses
  const now=new Date();
  if(!statsMonth)statsMonth={y:now.getFullYear(),m:now.getMonth()};
  const my=statsMonth.y,mm=statsMonth.m;
  let monthLabel=new Date(my,mm,1).toLocaleString('es',{month:'long',year:'numeric'});
  monthLabel=monthLabel.charAt(0).toUpperCase()+monthLabel.slice(1);
  const firstDow=(new Date(my,mm,1).getDay()+6)%7; // huecos antes del día 1 (base lunes)
  const dim=new Date(my,mm+1,0).getDate();
  const todayMid=new Date();todayMid.setHours(0,0,0,0);
  const calHead=WD.map(w=>`<div class="cal-head">${w}</div>`).join('');
  let cells='';
  for(let i=0;i<firstDow;i++)cells+=`<div class="cal-cell empty"></div>`;
  for(let d=1;d<=dim;d++){
    const key=`${my}-${String(mm+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const done=(hist[key]?.rehabDone)||(key===td()&&(state.rehabXpToday||0)>0);
    const isToday=key===td();
    const future=new Date(my,mm,d)>todayMid;
    cells+=`<div class="cal-cell${done?' done':''}${isToday?' today':''}"${future?' style="opacity:.3"':''}>${d}</div>`;
  }
  const isCurrentMonth=my===now.getFullYear()&&mm===now.getMonth();

  // Resumen
  const totalRehabDays=state.rehabDaysTotal||0;
  const bestStreak=state.streak||0;
  const totalXP=state.xp||0;

  return `
<div class="sec-head"><div class="sec-title">📊 Progreso${name?' · '+name:''}</div><div class="sec-sub">Tu constancia semana a semana</div></div>

<div class="summary-row">
  <div class="sum-card"><div class="sum-val">${totalXP}</div><div class="sum-lbl">XP Total</div></div>
  <div class="sum-card"><div class="sum-val">${bestStreak}</div><div class="sum-lbl">Racha actual</div></div>
  <div class="sum-card"><div class="sum-val">${totalRehabDays}</div><div class="sum-lbl">Días rehab</div></div>
</div>

<div class="chart-card">
  <div class="chart-title">⚡ XP ganado por día</div>
  <div class="chart-sub">Esta semana · * = hoy</div>
  <div class="chart-wrap">${barChart(xpVals,maxXP,'#1a2035','#2d3a52')}</div>
  <div class="bar-labels">${labelHtml}</div>
</div>

<div class="chart-card">
  <div class="cal-nav">
    <button class="cal-nav-btn" onclick="changeStatsMonth(-1)" aria-label="Mes anterior">‹</button>
    <div class="cal-month">${monthLabel}</div>
    <button class="cal-nav-btn${isCurrentMonth?' disabled':''}" ${isCurrentMonth?'disabled':''} onclick="changeStatsMonth(1)" aria-label="Mes siguiente">›</button>
  </div>
  <div class="chart-sub" style="margin-bottom:10px">🦵 Rehab · <span style="color:var(--green2);font-weight:700">verde</span> = día completado</div>
  <div class="cal-grid">${calHead}${cells}</div>
</div>`;
}

// ============================================================================
// Unified MAXER: diario, PIN, minimos diarios y migracion suave
// ============================================================================
const MAXER_PIN_KEY='maxer_pin_v1';
const DIARIO_SK='diario_v1',DIARIO_NK='diario_notif_v1',DIARIO_PK='diario_profile_v1';
const DIARIO_PIN_KEY='diario_pin_v2',DIARIO_OLD_PIN_KEY='diario_pin_v1';
const MONTHS=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const WEEKDAYS=['Lun','Mar','Mie','Jue','Vie','Sab','Dom'];
const WEEKSHORT=['Dom','Lun','Mar','Mie','Jue','Vie','Sab'];
const DEFAULT_MINIMUMS=[
  {id:'rehab',name:'Pierna / Rehab',emoji:'🦵',desc:'Movilidad suave o rutina completa',minimum:'Movilidad suave',complete:'Rutina completa'},
  {id:'journal',name:'Diario',emoji:'✍️',desc:'Una frase para cerrar el día',minimum:'1 frase',complete:'Reflexión larga'},
  {id:'walk',name:'Paseo',emoji:'🚶',desc:'Salir a moverte un poco',minimum:'5 minutos',complete:'20 minutos'},
  {id:'reading',name:'Leer',emoji:'📖',desc:'Mantener contacto con el libro',minimum:'2 páginas',complete:'10 páginas'},
  {id:'breathing',name:'Respirar',emoji:'🌬️',desc:'Bajar revoluciones',minimum:'1 minuto',complete:'5 minutos'},
  {id:'protein',name:'Proteína',emoji:'🥩',desc:'Cuidar recuperación y energía',minimum:'1 comida proteica',complete:'Objetivo diario'},
  {id:'deficit',name:'Déficit',emoji:'🥗',desc:'Día nutricional consciente',minimum:'Elegir mejor una comida',complete:'Déficit cumplido'},
  {id:'agua',name:'Agua',emoji:'💧',desc:'Hidratarte sin complicarte',minimum:'1 vaso',complete:'2.5 L'},
  {id:'sleep',name:'Sueño',emoji:'😴',desc:'Preparar descanso',minimum:'Rutina de cierre',complete:'7.5 h o mas'},
  {id:'study',name:'Estudio',emoji:'🎓',desc:'Avanzar con calma',minimum:'25 minutos',complete:'2 bloques o mas'},
  {id:'project',name:'Proyecto personal',emoji:'🛠️',desc:'Un paso real',minimum:'5 minutos',complete:'Bloque completo'}
];
const HABIT_TO_MINIMUM={walk:'walk',reading:'reading',breathing:'breathing',protein:'protein',deficit:'deficit',agua:'agua','sueño':'sleep'};
let pinInput='',pinMode='unlock',pinUnlocked=false,journalNotifTimer=null;
let syncStatus='idle',syncMessage='',syncTimer=null,pendingCloudSave=null,lastStateSizeBytes=0,stateSizeWarned=false;
let archivedDayOnLoad=null;

function renderSyncStatus(){
  const el=document.getElementById('syncIndicator');
  if(!el)return;
  el.className='sync-indicator '+syncStatus+((syncStatus==='idle'||!syncMessage)?' hidden':'');
  el.textContent=syncMessage;
}
function setSyncStatus(status,message,autoHide=false){
  // No mostramos los estados rutinarios de guardado (molesto). Solo avisos útiles: sin conexión / error.
  if(status==='saving'||status==='saved'){
    syncStatus='idle';syncMessage='';clearTimeout(syncTimer);renderSyncStatus();return;
  }
  syncStatus=status;syncMessage=message||'';
  clearTimeout(syncTimer);
  renderSyncStatus();
  if(autoHide)syncTimer=setTimeout(()=>{syncStatus='idle';syncMessage='';renderSyncStatus()},2500);
}
function estimateStateBytes(data){
  try{
    const json=typeof data==='string'?data:JSON.stringify(data);
    if(window.TextEncoder)return new TextEncoder().encode(json).length;
    return json.length;
  }catch(e){return 0}
}
function checkStateSize(serialized){
  lastStateSizeBytes=estimateStateBytes(serialized);
  if(lastStateSizeBytes>750*1024&&!stateSizeWarned){
    stateSizeWarned=true;
    console.warn('[MAXER] Tus datos están creciendo mucho. Pronto convendrá optimizar el diario.',{bytes:lastStateSizeBytes});
  }
}
function cloudStatePayload(data){
  const p=JSON.parse(JSON.stringify(data||{}));
  if(!p.journal||typeof p.journal!=='object')p.journal={};
  p.journal.entries={};
  delete p.tab;

  delete p.hiperDay;
  delete p.journalUi;
  return p;
}
function journalEntriesPayload(data){
  return JSON.parse(JSON.stringify(data?.journal?.entries||{}));
}
function journalDocRef(){
  return db.collection('users').doc(currentUser.uid).collection('journal').doc('entries');
}
async function writeJournalEntries(entries){
  if(!currentUser)return;
  await journalDocRef().set({entries:entries||{},updatedAt:new Date().toISOString()});
}

function safeParse(v,f){try{return JSON.parse(v)||f}catch(e){return f}}
function esc(s){return String(s||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function jKey(y,m,d){return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`}
function dateParts(key){const [y,m,d]=String(key).split('-').map(Number);return {y,m:m-1,d}}
function todayParts(){const n=new Date();return {y:n.getFullYear(),m:n.getMonth(),d:n.getDate()}}
function readLocalJSON(key,f){return safeParse(localStorage.getItem(key),f)}
async function sha256(text){if(!crypto?.subtle)return text;const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function getPinHash(){const own=localStorage.getItem(MAXER_PIN_KEY);if(own)return own;const diary=localStorage.getItem(DIARIO_PIN_KEY);if(diary)return diary;const old=localStorage.getItem(DIARIO_OLD_PIN_KEY);if(old)return await sha256(old);return ''}
async function setPin(pin){if(pin)localStorage.setItem(MAXER_PIN_KEY,await sha256(pin));else localStorage.removeItem(MAXER_PIN_KEY)}

function ensureUnifiedState(){
  if(!state||typeof state!=='object') state=DS();
  state.journal=state.journal&&typeof state.journal==='object'?state.journal:{};
  state.journal.entries=state.journal.entries&&typeof state.journal.entries==='object'?state.journal.entries:{};
  state.journal.notifications=state.journal.notifications&&typeof state.journal.notifications==='object'?state.journal.notifications:{enabled:false,time:'21:00'};
  state.journalUi=state.journalUi&&typeof state.journalUi==='object'?state.journalUi:{year:new Date().getFullYear(),month:new Date().getMonth(),view:'cal',activeDate:null};
  state.dailyMinimums=state.dailyMinimums&&typeof state.dailyMinimums==='object'?state.dailyMinimums:{};
  state.minimumSettings=state.minimumSettings&&typeof state.minimumSettings==='object'?state.minimumSettings:{};
  DEFAULT_MINIMUMS.forEach(m=>{if(!state.minimumSettings[m.id])state.minimumSettings[m.id]={active:true}});
  state.rescues=state.rescues&&typeof state.rescues==='object'?state.rescues:{};
  state.nonZeroHistory=state.nonZeroHistory&&typeof state.nonZeroHistory==='object'?state.nonZeroHistory:{};
  state.migrations=state.migrations&&typeof state.migrations==='object'?state.migrations:{};
  state.profile=state.profile&&typeof state.profile==='object'?state.profile:{name:'',rehabDaysGoal:4,reminderTime:'19:00',reminderEnabled:false,onboardingDone:false};
  if(!state.profile.primaryGoal) state.profile.primaryGoal='todo';
  if(!state.profile.reminderTime) state.profile.reminderTime='19:00';
  if(!state.profile.rehabDaysGoal) state.profile.rehabDaysGoal=4;
  if(state.profile.rehabEnabled===undefined) state.profile.rehabEnabled=true;
  state.profile.onboardingDone=true;

  if(state.tab==='journal'||state.tab==='recomp') state.tab='home';
  if(!state.training||typeof state.training!=='object') state.training={weights:{},prs:{}};
  if(!state.training.weights||typeof state.training.weights!=='object') state.training.weights={};
  if(!state.training.prs||typeof state.training.prs!=='object') state.training.prs={};
  if(!state.recomp||typeof state.recomp!=='object') state.recomp={entries:{},measures:{},goal:{targetWeight:85,targetBF:11,startWeight:92,startBF:16,startDate:null},xpToday:false};
  if(!state.recomp.entries||typeof state.recomp.entries!=='object') state.recomp.entries={};
  if(!state.recomp.measures||typeof state.recomp.measures!=='object') state.recomp.measures={};
  if(!state.recomp.goal||typeof state.recomp.goal!=='object') state.recomp.goal={targetWeight:85,targetBF:11,startWeight:92,startBF:16,startDate:null};
  if(!state.habitSettings||typeof state.habitSettings!=='object') state.habitSettings={};
  return state;
}

function migrateLegacyData(){
  ensureUnifiedState();
  if(!state.migrations.diario_v1){
    const oldEntries=readLocalJSON(DIARIO_SK,{});
    let added=0;
    Object.keys(oldEntries||{}).forEach(k=>{
      const txt=String(oldEntries[k]||'').trim();
      if(/^\d{4}-\d{2}-\d{2}$/.test(k)&&txt&&!state.journal.entries[k]){state.journal.entries[k]=txt;added++}
    });
    const oldProfile=readLocalJSON(DIARIO_PK,null);
    if(oldProfile){
      if(!state.profile.name&&oldProfile.name)state.profile.name=oldProfile.name;
      if(oldProfile.lang&&!state.profile.lang)state.profile.lang=oldProfile.lang;
    }
    const oldNotif=readLocalJSON(DIARIO_NK,null);
    if(oldNotif&&oldNotif.time&&!state.journal.notifications?.enabled)state.journal.notifications={enabled:!!oldNotif.enabled,time:oldNotif.time};
    state.migrations.diario_v1={done:true,at:new Date().toISOString(),entries:added};
  }
  state.migrations.unified_v1=true;
}

function hasExistingProgress(){
  ensureUnifiedState();
  return (state.xp||0)>0||(state.rehabDaysTotal||0)>0||Object.keys(state.history||{}).length>0||
    Object.keys(state.journal.entries||{}).length>0||Object.values(state.habits||{}).some(Boolean)||
    tPush()>0||Object.values(state.legs||{}).some(a=>Array.isArray(a)&&a.some(Boolean));
}

function sanitize(s){
  function fixArr(val){
    if(Array.isArray(val))return val;
    if(val&&typeof val==='object'){
      const keys=Object.keys(val);
      if(keys.length&&keys.every(k=>!isNaN(k))){const max=Math.max(...keys.map(Number)),arr=[];for(let i=0;i<=max;i++)arr.push(val[i]===undefined?false:val[i]);return arr}
    }
    return [];
  }
  if(s.pushups&&typeof s.pushups==='object')Object.keys(s.pushups).forEach(k=>{s.pushups[k]=fixArr(s.pushups[k]).map(item=>item&&typeof item==='object'?{reps:item.reps||0,done:!!item.done,xpAwarded:item.xpAwarded||0}:{reps:0,done:false,xpAwarded:0})});
  ['legs','general'].forEach(field=>{if(s[field]&&typeof s[field]==='object')Object.keys(s[field]).forEach(k=>{s[field][k]=fixArr(s[field][k]).map(Boolean)})});
  s.earned=fixArr(s.earned).filter(v=>typeof v==='string');
  s.weeklyEarned=fixArr(s.weeklyEarned).filter(v=>typeof v==='string');
  if(s.habits)Object.keys(s.habits).forEach(k=>{s.habits[k]=!!s.habits[k]});
  state=s;ensureUnifiedState();migrateLegacyData();return state;
}

async function loadFS(){
  try{
    const stateDocRef=db.collection('users').doc(currentUser.uid).collection('data').doc('state');
    const journalRef=journalDocRef();
    const [doc,journalDoc]=await Promise.all([stateDocRef.get(),journalRef.get()]);
    const mainData=doc.exists?doc.data():null;
    const legacyEntries=mainData?.journal?.entries&&typeof mainData.journal.entries==='object'?mainData.journal.entries:{};
    if(doc.exists) state=sanitize({...DS(),...mainData});
    else loadLocal(false);
    ensureUnifiedState();
    const cloudJournalData=journalDoc.exists?journalDoc.data():null;
    const cloudEntries=cloudJournalData?.entries&&typeof cloudJournalData.entries==='object'?cloudJournalData.entries:{};
    state.journal.entries={...legacyEntries,...state.journal.entries,...cloudEntries};
    if(Object.keys(legacyEntries).length&&!state.migrations.journal_subcol){
      state.migrations.journal_subcol={done:true,at:new Date().toISOString(),entries:Object.keys(state.journal.entries).length};
      await writeJournalEntries(state.journal.entries);
      await stateDocRef.set(cloudStatePayload(state));
    }
  }catch(e){
    console.warn('[MAXER] No se pudo cargar Firestore; usando localStorage.',e);
    setSyncStatus(navigator.onLine?'error':'offline',navigator.onLine?'Error nube':'Sin conexión');
    loadLocal(false);
  }
  processLoad();
}
function loadLocal(runProcess=true){
  try{const r=localStorage.getItem('maxer_v1');if(r)state=sanitize({...DS(),...JSON.parse(r)});else{state=DS();ensureUnifiedState();migrateLegacyData()}}catch(e){console.warn('[MAXER] No se pudo leer localStorage; arrancando estado limpio.',e);state=DS();ensureUnifiedState();migrateLegacyData()}
  if(runProcess)processLoad();
}
function saveState(){
  ensureUnifiedState();
  state.date=td();
  const p=JSON.parse(JSON.stringify(state));
  let serialized='',localOk=false;
  try{
    serialized=JSON.stringify(p);
    checkStateSize(serialized);
    localStorage.setItem('maxer_v1',serialized);
    localOk=true;
  }catch(e){
    console.warn('[MAXER] Error guardando en localStorage.',e);
    setSyncStatus('error','Error local');
  }
  if(currentUser){
    pendingCloudSave=p;
    clearTimeout(saveTimer);
    if(!navigator.onLine){setSyncStatus('offline','Sin conexión');return}
    setSyncStatus('saving','Guardando...');
    saveTimer=setTimeout(()=>fsWrite(p),400);
  }else if(localOk){
    setSyncStatus('saved','Guardado',true);
  }
}
function fsWrite(data){
  if(!currentUser)return;
  if(!navigator.onLine){pendingCloudSave=data;setSyncStatus('offline','Sin conexión');return}
  setSyncStatus('saving','Guardando...');
  Promise.all([
    db.collection('users').doc(currentUser.uid).collection('data').doc('state').set(cloudStatePayload(data)),
    writeJournalEntries(journalEntriesPayload(data))
  ])
    .then(()=>{pendingCloudSave=null;setSyncStatus('saved','Guardado',true)})
    .catch(e=>{
      pendingCloudSave=data;
      console.warn('[MAXER] Error sincronizando Firestore; se conserva localStorage.',e);
      setSyncStatus(navigator.onLine?'error':'offline',navigator.onLine?'Error nube':'Sin conexión');
    });
}
function flushSave(){clearTimeout(saveTimer);ensureUnifiedState();if(currentUser)fsWrite(pendingCloudSave||JSON.parse(JSON.stringify(state)))}

function processLoad(){
  let before='';
  try{before=JSON.stringify(state)}catch(e){}
  ensureUnifiedState();migrateLegacyData();
  if(!state.profile.onboardingDone&&hasExistingProgress())state.profile.onboardingDone=true;
  const d=td(),w=ws();
  if(state.weekStart!==w){state.weeklyEarned=[];state.weekStart=w;state.rehabDaysThisWeek=0}
  if(state.date&&state.date!==d){
    const missed=Math.max(0,dBetween(state.date,d)-1);
    if(missed>0){
      const decay=Math.pow(0.88,missed),lost=Math.round((state.rehabXp||0)*(1-decay));
      state.rehabXp=Math.round((state.rehabXp||0)*decay);state.xp=Math.max(0,state.xp-lost);
      if(lost>0)state._decayMsg='Ajuste automático de rehab: '+lost+' XP tras días sin registrar entrenamiento.';
      if(dBetween(state.date,d)>1)state.streak=0;
    }
    const hp=Object.values(state.pushups||{}).some(s=>s.length>0);
    const hl=Object.values(state.legs||{}).some(a=>a.some(Boolean));
    archiveDay(state.date);
    archivedDayOnLoad=state.date;
    if(hp||hl)setTimeout(()=>document.getElementById('newDayModal').classList.remove('hidden'),600);
    else startNewDay();
  }
  let after='';
  try{after=JSON.stringify(state);checkStateSize(after)}catch(e){}
  if(before!==after)saveState();
  getPinHash().then(h=>{if(h&&!pinUnlocked)showPinScreen('unlock')});
}

function archiveDay(dayKey){
  if(!dayKey)return;
  if(!state.history)state.history={};
  const active=isNonZeroDay(dayKey)||tPush()>0||Object.values(state.legs||{}).some(a=>a.some(Boolean))||Object.values(state.general||{}).some(a=>a.some(Boolean));
  state.history[dayKey]={xp:state.xpToday||0,pushups:tPush(),rehabDone:(state.rehabXpToday||0)>0,nonZero:active};
  state.nonZeroHistory[dayKey]=active;
  const keys=Object.keys(state.history).sort();while(keys.length>90)delete state.history[keys.shift()];
}
function startNewDay(){
  ensureUnifiedState();
  const y=state.date;
  if(y!==archivedDayOnLoad)archiveDay(y);
  archivedDayOnLoad=null;
  if(y===td())delete state.dailyMinimums[y];
  state.pushups={};state.legs={};state.general={};
  state.habits={cold:false,walk:false,reading:false,breathing:false,protein:false,deficit:false,agua:false,sueño:false};
  state.habitXpToday=false;state.pushXpAwarded=0;state.rehabXpToday=0;state._decayMsg=null;state.xpToday=0;if(state.recomp)state.recomp.xpToday=false;
  state.date=td();state.streak=(state.streak||0)+1;
}
function doFullReset(){
  closeModal('fullResetModal');
  state=DS();ensureUnifiedState();state.profile.onboardingDone=false;saveState();renderAll();
  if(currentUser)Promise.all([
    db.collection('users').doc(currentUser.uid).collection('data').doc('state').set(cloudStatePayload(state)),
    writeJournalEntries({})
  ]).catch(e=>{console.warn('[MAXER] Error reiniciando Firestore.',e);setSyncStatus('error','Error nube')});
}

function initPinPad(){
  const dots=document.getElementById('pinDots'),pad=document.getElementById('pinPad');
  if(!dots||!pad||pad.dataset.ready)return;
  dots.innerHTML=Array.from({length:4},(_,i)=>`<span class="pin-dot" data-dot="${i}"></span>`).join('');
  pad.innerHTML=['1','2','3','4','5','6','7','8','9','','0','del'].map(v=>v===''?'<span class="pin-key ghost"></span>':`<button type="button" class="pin-key ${v==='del'?'del':''}" data-key="${v}" aria-label="${v==='del'?'Borrar':'Numero '+v}">${v==='del'?'⌫':v}</button>`).join('');
  pad.onclick=e=>{const b=e.target.closest('[data-key]');if(!b)return;b.dataset.key==='del'?pinDel():pinKey(b.dataset.key)};
  pad.dataset.ready='1';
}
function fillPinDots(len,err=false){document.querySelectorAll('#pinDots .pin-dot').forEach((d,i)=>{d.classList.toggle('filled',i<len);d.classList.toggle('error',err)})}
async function showPinScreen(mode='unlock'){initPinPad();pinMode=mode;pinInput='';document.getElementById('pinSub').textContent=mode==='set'?'Crea un PIN de 4 dígitos':'Introduce tu PIN para desbloquear la app';document.getElementById('pinResetBtn').classList.toggle('hidden',mode!=='unlock');fillPinDots(0);document.getElementById('pinScreen').classList.remove('hidden')}
function hidePinScreen(){document.getElementById('pinScreen').classList.add('hidden')}
async function pinKey(d){
  if(pinInput.length>=4)return;pinInput+=d;fillPinDots(pinInput.length);
  if(pinInput.length<4)return;
  if(pinMode==='set'){await setPin(pinInput);pinUnlocked=true;hidePinScreen();saveState();render();return}
  const good=(await getPinHash())===await sha256(pinInput);
  if(good){pinUnlocked=true;hidePinScreen()}else{document.getElementById('pinSub').textContent='PIN incorrecto';fillPinDots(4,true);setTimeout(()=>{pinInput='';fillPinDots(0);document.getElementById('pinSub').textContent='Introduce tu PIN para desbloquear la app'},700)}
}
function pinDel(){pinInput=pinInput.slice(0,-1);fillPinDots(pinInput.length)}
async function forgotPin(){
  if(confirm('Si olvidaste el PIN, puedes desactivarlo en este dispositivo. No se borrara tu progreso. ¿Desactivar PIN local?')){
    localStorage.removeItem(MAXER_PIN_KEY);localStorage.removeItem(DIARIO_PIN_KEY);localStorage.removeItem(DIARIO_OLD_PIN_KEY);pinUnlocked=true;hidePinScreen();render();
  }
}
async function togglePinSetting(){
  if(await getPinHash()){if(confirm('¿Desactivar el PIN en este dispositivo?')){await setPin('');localStorage.removeItem(DIARIO_PIN_KEY);localStorage.removeItem(DIARIO_OLD_PIN_KEY);render()}}
  else showPinScreen('set');
}

async function showApp(){
  ensureUnifiedState();
  document.getElementById('loginScreen').classList.add('hidden');
  const _ma=document.getElementById('mainApp');if(_ma)_ma.style.display='block';
  checkDailyReminder();startJournalNotifLoop();renderAll();
  if((await getPinHash())&&!pinUnlocked)showPinScreen('unlock');
}
async function doLogout(){
  closeModal('logoutModal');flushSave();if(journalNotifTimer){clearInterval(journalNotifTimer);journalNotifTimer=null}await auth.signOut();appLoaded=false;pinUnlocked=false;state=DS();ensureUnifiedState();
  const _ma2=document.getElementById('mainApp');if(_ma2)_ma2.style.display='none';
  document.getElementById('loginScreen').classList.remove('hidden');
}
function openDeleteAccountModal(){
  const input=document.getElementById('deleteAccountConfirm'),msg=document.getElementById('deleteAccountMsg');
  if(input)input.value='';
  if(msg)msg.textContent='';
  document.getElementById('deleteAccountModal').classList.remove('hidden');
  setTimeout(()=>input?.focus(),60);
}
function removeLocalAppData(){
  const keys=[MAXER_PIN_KEY,DIARIO_SK,DIARIO_NK,DIARIO_PK,DIARIO_PIN_KEY,DIARIO_OLD_PIN_KEY,'maxer_v1','diario_view'];
  try{
    keys.forEach(k=>localStorage.removeItem(k));
    Object.keys(localStorage).filter(k=>k.startsWith('maxer_journal_notif_')).forEach(k=>localStorage.removeItem(k));
  }catch(e){console.warn('[MAXER] Error borrando datos locales de la app.',e)}
}
async function deleteAccountAndData(){
  const input=document.getElementById('deleteAccountConfirm'),msg=document.getElementById('deleteAccountMsg');
  if((input?.value||'')!=='ELIMINAR'){
    if(msg)msg.textContent='Escribe ELIMINAR para confirmar.';
    input?.focus();
    return;
  }
  if(msg)msg.textContent='Eliminando datos...';
  const user=auth?.currentUser||currentUser;
  try{
    if(user&&db){
      await Promise.all([
        db.collection('users').doc(user.uid).collection('data').doc('state').delete().catch(e=>console.warn('[MAXER] Error borrando state en Firestore.',e)),
        db.collection('users').doc(user.uid).collection('journal').doc('entries').delete().catch(e=>console.warn('[MAXER] Error borrando diario en Firestore.',e))
      ]);
      if(auth?.currentUser?.delete){
        await auth.currentUser.delete().catch(e=>console.warn('[MAXER] No se pudo eliminar la cuenta Firebase; puede requerir login reciente.',e));
      }
    }
  }finally{
    removeLocalAppData();
    try{if(auth?.currentUser)await auth.signOut()}catch(e){console.warn('[MAXER] Error cerrando sesion tras eliminar datos.',e)}
    state=DS();ensureUnifiedState();currentUser=null;location.reload();
  }
}

function getDayMinimums(date=td()){ensureUnifiedState();if(!state.dailyMinimums[date])state.dailyMinimums[date]={};return state.dailyMinimums[date]}
function getMinimum(id,date=td()){const d=getDayMinimums(date);if(!d[id])d[id]={status:'pending',note:'',date};return d[id]}
function setMinimum(id,status,note='',date=td()){
  const m=getMinimum(id,date);m.status=status;m.note=note||m.note||'';m.date=date;
  if(status==='minimum'||status==='complete')state.nonZeroHistory[date]=true;
  saveState();renderAll();
}
function completeMinimum(id,status='minimum'){setMinimum(id,status)}
function skipMinimum(id){const reason=prompt('Motivo opcional para saltarlo sin culpa:','');setMinimum(id,'skipped',reason||'')}
function isNonZeroDay(date=td()){
  ensureUnifiedState();
  const mins=state.dailyMinimums?.[date]||{};
  if(Object.values(mins).some(m=>m&&['minimum','complete'].includes(m.status)))return true;
  if(String(state.journal.entries?.[date]||'').trim())return true;
  if(date===td()&&(tPush()>0||Object.values(state.legs||{}).some(a=>a.some(Boolean))||Object.values(state.general||{}).some(a=>a.some(Boolean))))return true;
  if((state.rescues?.[date]||[]).length)return true;
  return !!state.nonZeroHistory?.[date];
}
function nonZeroStreak(){
  let n=0,d=new Date();for(;;){const k=d.toISOString().slice(0,10);if(isNonZeroDay(k)){n++;d.setDate(d.getDate()-1)}else break}return n;
}
function statusLabel(s){return s==='complete'?'Completo hecho':s==='minimum'?'Mínimo hecho':s==='skipped'?'Saltado':'Pendiente'}

function openRescueModal(){
  const actions=[
    ['journal','Escribir una frase del diario'],
    ['reading','Leer 1 página'],
    ['breathing','Respirar 1 minuto'],
    ['project','Preparar el escritorio para mañana'],
    ['presence','Marcar hice acto de presencia']
  ];
  document.getElementById('rescueActions').innerHTML=actions.map(a=>`<button class="rescue-btn" onclick="completeRescue('${a[0]}')">${a[1]}</button>`).join('');
  document.getElementById('rescueModal').classList.remove('hidden');
}
function completeRescue(id){
  ensureUnifiedState();
  if(!state.rescues[td()])state.rescues[td()]=[];
  if(!state.rescues[td()].includes(id))state.rescues[td()].push(id);
  if(id==='journal'){closeModal('rescueModal');openJournalDate(td());return}
  const map={reading:'reading',breathing:'breathing',project:'project',presence:'project'};
  setMinimum(map[id]||id,'minimum','accion de rescate');
  closeModal('rescueModal');showXPPop('Mínimo hecho. El día ya cuenta.');
}

function toggleHabit(id){
  ensureUnifiedState();
  const h=HABITS.find(x=>x.id===id);
  if(!h)return;
  state.habits[id]=!state.habits[id];
  if(state.habits[id]){awardXP(3,'Habito');if(HABIT_TO_MINIMUM[id])getMinimum(HABIT_TO_MINIMUM[id]).status='minimum'}
  else if(HABIT_TO_MINIMUM[id]&&getMinimum(HABIT_TO_MINIMUM[id]).status==='minimum')getMinimum(HABIT_TO_MINIMUM[id]).status='pending';
  if(HABITS.every(h2=>!!state.habits[h2.id])&&!state.habitXpToday){state.habitXpToday=true;awardXP(25,'Todos los hábitos')}
  saveState();renderHabits();checkAch();render();
}
function togPS(tid,i){
  const s=state.pushups[tid][i];s.done=!s.done;
  if(s.done){startRest(45);const aw=Math.max(0,Math.floor((s.reps||0)/5));s.xpAwarded=aw;if(aw>0)awardXP(aw,'Flexiones');if(tPush()>=75&&state.pushXpAwarded<75){awardXP(50,'75 Flexiones');state.pushXpAwarded=75}state.nonZeroHistory[td()]=true}
  else{const aw=s.xpAwarded||0;s.xpAwarded=0;if(aw>0)deductXP(aw,false);if(tPush()<75&&state.pushXpAwarded>=75){deductXP(50,false);state.pushXpAwarded=0}saveState()}
  saveState();render();
}
function togRehab(exId,i,ex){
  if(!state.legs[exId])state.legs[exId]=[];
  const cur=!!state.legs[exId][i];
  const done=()=>{state.legs[exId][i]=true;startRest(45);awardXP(2,'Serie rehab',true);getMinimum('rehab').status='minimum';checkRehabDone();saveState();render()};
  if(!cur&&ex.unit==='s')startTimer(typeof ex.reps==='number'?ex.reps:parseInt(ex.reps),ex.name,done);
  else if(!cur)done();
  else{state.legs[exId][i]=false;deductXP(2,true);if(state.rehabXpToday>0){deductXP(state.rehabXpToday,true);state.rehabXpToday=0;state.rehabDaysTotal=Math.max(0,(state.rehabDaysTotal||0)-1);state.rehabDaysThisWeek=Math.max(0,(state.rehabDaysThisWeek||0)-1)}saveState();render()}
}
function checkRehabDone(){
  const w=RW[state.rehabWeek],exs=w.exercises;
  const tot=exs.reduce((s,e)=>s+(e.perLeg?e.sets*2:e.sets),0);
  const done=exs.reduce((s,e)=>s+((state.legs[e.id]||[]).filter(Boolean).length),0);
  if(done===tot&&tot>0&&state.rehabXpToday===0){const b=30;state.rehabXpToday=b;state.rehabDaysTotal=(state.rehabDaysTotal||0)+1;state.rehabDaysThisWeek=(state.rehabDaysThisWeek||0)+1;getMinimum('rehab').status='complete';awardXP(b,'Rehab completa',true);saveState()}
}
function togGen(exId,i,ex){
  ensureUnifiedState();
  if(!state.general[exId])state.general[exId]=[];
  const cur=!!state.general[exId][i];
  const done=()=>{
    state.general[exId][i]=true;startRest(45);awardXP(2,'General');state.nonZeroHistory[td()]=true;
    const ts=ex.perLeg?ex.sets*2:ex.sets;
    const allDone=(state.general[exId]||[]).filter(Boolean).length===ts;
    if(allDone) checkAndUpdatePR(exId,ex);
    saveState();render()
  };
  if(!cur&&ex.unit==='s')startTimer(typeof ex.reps==='number'?ex.reps:parseInt(ex.reps),ex.name,done);
  else if(!cur)done();
  else{state.general[exId][i]=false;deductXP(2,false);saveState();render()}
}
function setTrainingWeight(exId,val){
  ensureUnifiedState();
  const kg=parseFloat(val)||0;
  state.training.weights[exId]=kg;
  saveState();
}
function checkAndUpdatePR(exId,ex){
  ensureUnifiedState();
  const kg=state.training.weights[exId]||0;
  if(!kg||ex.unit==='s') return false;
  const reps=typeof ex.reps==='string'?parseInt(ex.reps):ex.reps;
  const vol=kg*reps;
  const cur=state.training.prs[exId];
  if(!cur||vol>(cur.kg*cur.reps)){
    state.training.prs[exId]={kg,reps,date:td()};
    setTimeout(()=>{const p=document.createElement('div');p.className='xp-pop';p.textContent='🏆 ¡Nuevo PR!';document.body.appendChild(p);setTimeout(()=>p.remove(),1600)},100);
    return true;
  }
  return false;
}

function updateNavActive(){
  ['home','rehab','training','progress','settings'].forEach(id=>{
    const nav=document.getElementById('nav'+id.charAt(0).toUpperCase()+id.slice(1));
    if(nav){const active=state.tab===id;nav.className='nav-btn'+(active?' active':'');active?nav.setAttribute('aria-current','page'):nav.removeAttribute('aria-current')}
  });
  const settingsBtn=document.getElementById('settingsBtn');if(settingsBtn)settingsBtn.className='settings-btn'+(state.tab==='settings'?' active':'');
}
function switchTab(t){
  state.tab=t;
  updateNavActive();
  saveState();render();
}
function renderAll(){ensureUnifiedState();updateHeader();renderHabits();render()}
function render(){
  ensureUnifiedState();
  updateNavActive();
  const hs=document.getElementById('habitsSection');
  if(hs)hs.style.display=state.tab==='home'?'':'none';
  const c=document.getElementById('content');
  switch(state.tab){
    case 'home':c.innerHTML=rHome();break;
    case 'rehab':c.innerHTML=rRehab();break;
    case 'journal':c.innerHTML=rJournal();break;
    case 'training':c.innerHTML=rTraining();break;
    case 'progress':c.innerHTML=rProgress();break;
    case 'settings':c.innerHTML=rSettings();break;
    case 'stats':c.innerHTML=rProgress();break;
    case 'recomp':c.innerHTML=rRecomp();break;
    default:c.innerHTML=rHome();
  }
  document.querySelectorAll('.reps-input').forEach(inp=>inp.addEventListener('input',e=>{const{type:t,idx:i}=e.target.dataset;setReps(t,parseInt(i),e.target.value)}));
}

function rHome(){
  const name=state.profile?.name||'';
  const nz=isNonZeroDay(),mins=DEFAULT_MINIMUMS.filter(m=>state.minimumSettings[m.id]?.active!==false);
  const doneMins=mins.filter(m=>['minimum','complete'].includes(getMinimum(m.id).status)).length;
  const completeMins=mins.filter(m=>getMinimum(m.id).status==='complete').length;
  const pr=tPush(),wk=RW[state.rehabWeek],rt=wk.exercises.reduce((s,e)=>s+(e.perLeg?e.sets*2:e.sets),0),rd=wk.exercises.reduce((s,e)=>s+((state.legs[e.id]||[]).filter(Boolean).length),0);
  const wAchs=ACH.filter(a=>a.weekly),pAchs=ACH.filter(a=>!a.weekly);
  const decay=state._decayMsg?'<div class="decay-warning"><span>⚙️</span><span>'+state._decayMsg+'</span></div>':'';
  return decay+
  `<div class="nonzero-banner"><div class="nonzero-title">${name?'Hola, '+esc(name)+'. ':''}${nz?'Hoy ya cuenta':'Aún puedes salvar el día'}</div><div class="nonzero-sub">${nz?'Día no-cero conseguido. Vas bien. Sigue simple.':'No buscamos días perfectos. Buscamos días no-cero.'}</div></div>`+
  `<button class="save-day-btn" onclick="openRescueModal()">Salvar el día</button>`+
  `<div class="stats-grid"><div class="stat-card accent"><div class="stat-label">MÍNIMOS</div><div class="stat-val">${doneMins}/${mins.length}</div><div class="stat-sub">${completeMins} completos</div></div><div class="stat-card"><div class="stat-label">DÍA NO-CERO</div><div class="stat-val">${nonZeroStreak()}</div><div class="stat-sub">racha amable</div></div><div class="stat-card"><div class="stat-label">FLEXIONES</div><div class="stat-val">${pr}</div><div class="stat-sub">/ 75 objetivo</div></div><div class="stat-card"><div class="stat-label">REHAB</div><div class="stat-val">${rd}</div><div class="stat-sub">/ ${rt} series</div></div></div>`+
  `<div class="sec-head"><div class="sec-title">Mínimos diarios</div><div class="sec-sub">Versión mínima o completa. Sin culpa, con constancia.</div></div>`+
  `<div class="minimum-list">${mins.map(m=>{const st=getMinimum(m.id).status;const nm=esc(m.name);return `<div class="minimum-item"><div class="minimum-top"><span class="minimum-emoji">${m.emoji}</span><div><div class="minimum-title">${m.name}</div><div class="minimum-desc">Mínimo: ${m.minimum} · Completo: ${m.complete}</div></div><span class="minimum-state ${st}">${statusLabel(st)}</span></div><div class="minimum-actions"><button class="mini-action ${st==='minimum'?'done':''}" aria-label="${nm}: marcar versión mínima" onclick="completeMinimum('${m.id}','minimum')">Versión mínima</button><button class="mini-action ${st==='complete'?'done':''}" aria-label="${nm}: marcar completo" onclick="completeMinimum('${m.id}','complete')">Completo</button><button class="mini-action ${st==='skipped'?'done':''}" aria-label="${nm}: saltar con motivo opcional" onclick="skipMinimum('${m.id}')">Saltar</button></div></div>`}).join('')}</div>`+
  `<div class="sec-head" style="margin-bottom:8px"><div class="sec-title">Logros</div><div class="sec-sub">Se conservan los logros de MAXER.</div></div>`+
  `<div class="achieve-wrap"><div class="achieve-scroll">${wAchs.concat(pAchs).map(a=>'<div class="achieve-chip'+((a.weekly?state.weeklyEarned:state.earned).includes(a.id)?' earned':'')+'"><span>'+a.emoji+'</span><span class="ach-name">'+a.name+'</span></div>').join('')}</div></div>`;
}

function rTraining(){return rGen();}

function journalEntries(){ensureUnifiedState();return state.journal.entries}
function rJournal(){
  const ui=state.journalUi,entries=journalEntries(),dim=new Date(ui.year,ui.month+1,0).getDate();
  const stats=journalStats(ui.year,ui.month);
  return `<div class="sec-head"><div class="sec-title">Diario</div><div class="sec-sub">Una frase por día. También cuenta como mínimo.</div></div>`+
  `<div class="journal-toolbar"><button class="seg-btn ${ui.view==='cal'?'active':''}" onclick="setJournalView('cal')">Calendario</button><button class="seg-btn ${ui.view==='list'?'active':''}" onclick="setJournalView('list')">Lista</button><button class="seg-btn ${ui.view==='year'?'active':''}" onclick="setJournalView('year')">Año</button><div class="month-nav" style="${ui.view==='year'?'display:none':''}"><button onclick="moveJournalMonth(-1)">‹</button><span class="month-name">${MONTHS[ui.month]} ${ui.year}</span><button onclick="moveJournalMonth(1)">›</button></div></div>`+
  `<div class="journal-stats"><div class="journal-stat"><div class="journal-stat-num">${stats.month}</div><div class="journal-stat-label">Este mes</div></div><div class="journal-stat"><div class="journal-stat-num">${stats.total}</div><div class="journal-stat-label">Total</div></div><div class="journal-stat"><div class="journal-stat-num">${stats.streak}</div><div class="journal-stat-label">Racha</div></div><div class="journal-stat"><div class="journal-stat-num">${stats.pct}%</div><div class="journal-stat-label">Completado</div></div></div>`+
  `<div class="journal-toolbar"><button class="seg-btn" onclick="openJournalDate(td())">Escribir hoy</button><button class="seg-btn" onclick="toggleJournalNotif()">${state.journal.notifications?.enabled?'Aviso activo':'Activar aviso'}</button><button class="seg-btn" onclick="openSheet('journalDataOverlay')">Datos</button></div>`+
  (ui.view==='cal'?rJournalCal(ui,entries,dim):ui.view==='list'?rJournalList(ui,entries,dim):rJournalYear(entries));
}
function journalStats(y,m){
  const e=journalEntries(),dim=new Date(y,m+1,0).getDate();let month=0;
  for(let d=1;d<=dim;d++)if(String(e[jKey(y,m,d)]||'').trim())month++;
  const total=Object.values(e).filter(v=>String(v||'').trim()).length;
  let streak=0,cur=new Date();cur=new Date(cur.getFullYear(),cur.getMonth(),cur.getDate());
  while(String(e[jKey(cur.getFullYear(),cur.getMonth(),cur.getDate())]||'').trim()){streak++;cur.setDate(cur.getDate()-1)}
  return {month,total,streak,pct:Math.round(month/dim*100)};
}
function rJournalCal(ui,entries,dim){
  const now=new Date(),off=(new Date(ui.year,ui.month,1).getDay()+6)%7;let html='<div class="weekdays">'+WEEKDAYS.map(d=>`<span>${d}</span>`).join('')+'</div><div class="journal-calendar">';
  for(let i=0;i<off;i++)html+='<span class="day-card empty"></span>';
  for(let d=1;d<=dim;d++){const k=jKey(ui.year,ui.month,d),txt=entries[k]||'',has=txt.trim(),isToday=now.getFullYear()===ui.year&&now.getMonth()===ui.month&&now.getDate()===d,isPast=new Date(ui.year,ui.month,d)<new Date(now.getFullYear(),now.getMonth(),now.getDate());html+=`<button class="day-card ${has?'has':''} ${isToday?'today':''} ${isPast&&!isToday?'past':''}" onclick="openJournalDate('${k}')"><span style="display:flex;align-items:center"><span class="day-num">${d}</span>${has?'<span class="entry-dot"></span>':''}</span>${has?`<span class="day-text">${esc(txt)}</span>`:`<span class="day-hint">Añadir</span>`}</button>`}
  return html+'</div>';
}
function rJournalList(ui,entries,dim){
  let html='<div class="journal-list">';
  const now=new Date();
  for(let d=1;d<=dim;d++){const k=jKey(ui.year,ui.month,d),txt=entries[k]||'',dt=new Date(ui.year,ui.month,d),isToday=now.getFullYear()===ui.year&&now.getMonth()===ui.month&&now.getDate()===d;html+=`<button class="journal-row ${txt.trim()?'has':''} ${isToday?'today':''}" onclick="openJournalDate('${k}')"><span class="journal-row-date">${WEEKSHORT[dt.getDay()]} ${d}</span><span class="journal-row-text ${txt.trim()?'':'journal-empty'}">${txt.trim()?esc(txt):'—'}</span><span style="color:var(--faint)">›</span></button>`}
  return html+'</div>';
}
function rJournalYear(entries){
  const y=new Date().getFullYear();let html=`<div class="year-title">${y}</div><div class="year-grid">`;
  for(let m=0;m<12;m++){const dim=new Date(y,m+1,0).getDate(),off=(new Date(y,m,1).getDay()+6)%7;let days='',filled=0;for(let i=0;i<off;i++)days+='<span class="mini-day" style="background:transparent"></span>';for(let d=1;d<=dim;d++){const has=String(entries[jKey(y,m,d)]||'').trim();if(has)filled++;const t=todayParts(),ist=t.y===y&&t.m===m&&t.d===d;days+=`<span class="mini-day ${has?'has':''} ${ist?'today':''}"></span>`}html+=`<button class="year-card" onclick="state.journalUi.year=${y};state.journalUi.month=${m};setJournalView('cal')"><div class="mini-title">${MONTHS[m].slice(0,3)}</div><div class="mini-grid">${days}</div><div class="mini-count">${filled}/${dim}</div></button>`}
  return html+'</div>';
}
function setJournalView(v){state.journalUi.view=v;saveState();render()}
function moveJournalMonth(delta){let ui=state.journalUi;ui.month+=delta;if(ui.month<0){ui.month=11;ui.year--}if(ui.month>11){ui.month=0;ui.year++}saveState();render()}
function openJournalDate(date){ensureUnifiedState();state.journalUi.activeDate=date;const p=dateParts(date),val=journalEntries()[date]||'';document.getElementById('journalEntryDate').textContent=`${p.d} de ${MONTHS[p.m]} ${p.y}`;document.getElementById('journalEntryText').value=val;document.getElementById('journalDeleteBtn').classList.toggle('hidden',!val);openSheet('journalEntryOverlay');setTimeout(()=>document.getElementById('journalEntryText').focus(),180)}
function closeJournalEntry(){closeSheet('journalEntryOverlay');state.journalUi.activeDate=null}
function saveJournalEntry(){
  const date=state.journalUi.activeDate;if(!date)return;const val=document.getElementById('journalEntryText').value.trim();
  if(!val){deleteJournalEntry();return}
  journalEntries()[date]=val;if(date===td())setMinimum('journal','minimum');else saveState();
  closeJournalEntry();render();
}
function deleteJournalEntry(){const date=state.journalUi.activeDate;if(!date)return;delete journalEntries()[date];if(date===td()&&getMinimum('journal').status==='minimum')getMinimum('journal').status='pending';saveState();closeJournalEntry();render()}
function openSheet(id){document.getElementById(id).classList.add('open')}
function closeSheet(id){document.getElementById(id).classList.remove('open')}
function exportJournalJSON(){const data={version:3,source:'MAXER unified',exported:new Date().toISOString(),entries:journalEntries()};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`diario-${td()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1500)}
function importJournalJSON(file){if(!file)return;const reader=new FileReader();reader.onload=e=>{try{const data=JSON.parse(e.target.result),imported=data.entries&&typeof data.entries==='object'?data.entries:data;if(!imported||typeof imported!=='object')throw new Error('bad');Object.keys(imported).forEach(k=>{if(/^\d{4}-\d{2}-\d{2}$/.test(k)&&String(imported[k]||'').trim())journalEntries()[k]=String(imported[k]).trim()});saveState();closeSheet('journalDataOverlay');render();alert('Importación completada')}catch(err){alert('Archivo no válido')}};reader.readAsText(file)}
function buildJournalMonthHTML(y,m,entries=journalEntries()){const dim=new Date(y,m+1,0).getDate();let rows='';for(let d=1;d<=dim;d++){const txt=entries[jKey(y,m,d)]||'',wk=WEEKSHORT[new Date(y,m,d).getDay()];rows+=`<div class="print-row"><span class="print-day-wk">${wk}</span><span class="print-day-num">${d}</span><span class="${txt?'print-day-txt':'print-empty'}">${esc(txt)||'—'}</span></div>`}return `<section><div class="print-month-title">${MONTHS[m]}</div><div class="print-year">${y}</div>${rows}<br></section>`}
function printJournalMonth(){document.getElementById('printView').innerHTML=buildJournalMonthHTML(state.journalUi.year,state.journalUi.month);window.print()}
function printJournalAll(){const e=journalEntries(),years=Object.keys(e).map(k=>+k.slice(0,4)).filter(Boolean),min=Math.min(...years,new Date().getFullYear()),max=Math.max(...years,new Date().getFullYear());let html='';for(let y=min;y<=max;y++)for(let m=0;m<12;m++)if(Object.keys(e).some(k=>k.startsWith(`${y}-${String(m+1).padStart(2,'0')}`)))html+=buildJournalMonthHTML(y,m,e);document.getElementById('printView').innerHTML=html||buildJournalMonthHTML(state.journalUi.year,state.journalUi.month,e);window.print()}

async function toggleJournalNotif(){
  ensureUnifiedState();const n=state.journal.notifications||{enabled:false,time:'21:00'};
  if(!n.enabled){if(!('Notification'in window)){alert('Este navegador no permite notificaciones.');return}const perm=Notification.permission==='granted'?'granted':await Notification.requestPermission().catch(()=>'denied');if(perm!=='granted'){alert('Permiso denegado.');return}const time=prompt('Hora del aviso diario:',n.time||'21:00')||n.time||'21:00';state.journal.notifications={enabled:true,time}}
  else state.journal.notifications.enabled=false;
  saveState();startJournalNotifLoop();render();
}
function startJournalNotifLoop(){if(journalNotifTimer)clearInterval(journalNotifTimer);journalNotifTimer=setInterval(checkJournalNotification,30000);checkJournalNotification()}
function checkJournalNotification(){const n=state.journal?.notifications;if(!n?.enabled||!n.time||!('Notification'in window)||Notification.permission!=='granted')return;const now=new Date(),[hh,mm]=n.time.split(':').map(Number);if(now.getHours()!==hh||now.getMinutes()!==mm)return;const last='maxer_journal_notif_'+td();if(localStorage.getItem(last))return;localStorage.setItem(last,'1');if(String(journalEntries()[td()]||'').trim())return;new Notification('MAXER Diario',{body:'Una frase basta. Hoy también puede contar.',icon:'/icon-192.png'})}

function rRecompCard(){
  ensureUnifiedState();
  const entries=state.recomp.entries||{};
  const dates=Object.keys(entries).sort();
  const latest=dates.length?entries[dates[dates.length-1]]:null;
  const goal=state.recomp.goal||{};
  const startW=goal.startWeight||92,targetW=goal.targetWeight||85;
  const curW=latest?.weight||startW;
  const startBF=goal.startBF||16,targetBF=goal.targetBF||11;
  const curBF=latest?.bf||startBF;
  const wPct=Math.max(0,Math.min(100,Math.round((startW-curW)/(startW-targetW)*100)));
  const bfPct=Math.max(0,Math.min(100,Math.round((startBF-curBF)/(startBF-targetBF)*100)));
  return `<div class="chart-card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div><div class="chart-title">Composición corporal</div><div class="chart-sub">${dates.length} mediciones registradas</div></div>
      <button onclick="openRecompEntry()" style="background:var(--text);color:#fff;border:none;border-radius:9px;padding:7px 13px;font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif">+ Registrar</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div style="background:var(--surface2);border-radius:10px;padding:12px;border:1px solid var(--border)">
        <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Peso actual</div>
        <div style="font-size:24px;font-weight:800;font-family:'JetBrains Mono',monospace">${curW}<span style="font-size:13px;font-weight:600;color:var(--muted)"> kg</span></div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">Meta: ${targetW} kg</div>
      </div>
      <div style="background:var(--surface2);border-radius:10px;padding:12px;border:1px solid var(--border)">
        <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Grasa corporal</div>
        <div style="font-size:24px;font-weight:800;font-family:'JetBrains Mono',monospace">${curBF}<span style="font-size:13px;font-weight:600;color:var(--muted)"> %</span></div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">Meta: ${targetBF}%</div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div>
        <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;margin-bottom:4px"><span style="color:var(--muted)">Peso</span><span>${wPct}% del objetivo</span></div>
        <div style="height:6px;background:var(--bg);border-radius:6px;overflow:hidden"><div style="height:100%;background:var(--text);border-radius:6px;width:${wPct}%;transition:width .5s"></div></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;margin-bottom:4px"><span style="color:var(--muted)">Grasa</span><span>${bfPct}% del objetivo</span></div>
        <div style="height:6px;background:var(--bg);border-radius:6px;overflow:hidden"><div style="height:100%;background:var(--green);border-radius:6px;width:${bfPct}%;transition:width .5s"></div></div>
      </div>
    </div>
    ${dates.length>=2?`<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:flex;gap:12px;font-size:12px">
      <span style="color:var(--muted)">Desde inicio:</span>
      <span style="font-weight:700;color:${curW<startW?'var(--green)':'var(--muted)'}">${curW<startW?'−'+(startW-curW).toFixed(1)+' kg':'= peso'}</span>
      <span style="font-weight:700;color:${curBF<startBF?'var(--green)':'var(--muted)'}">${curBF<startBF?'−'+(startBF-curBF).toFixed(1)+'% BF':'= BF'}</span>
    </div>`:''}
  </div>`;
}
function openRecompEntry(){
  const today=td();
  const ex=state.recomp.entries?.[today]||{};
  document.getElementById('recompWeightIn').value=ex.weight||'';
  document.getElementById('recompBFIn').value=ex.bf||'';
  document.getElementById('recompNotesIn').value=ex.notes||'';
  document.getElementById('recompModal').classList.remove('hidden');
}
function saveRecompEntry2(){
  ensureUnifiedState();
  const today=td();
  const w=parseFloat(document.getElementById('recompWeightIn').value)||0;
  const bf=parseFloat(document.getElementById('recompBFIn').value)||0;
  const notes=document.getElementById('recompNotesIn').value.trim();
  if(!w&&!bf){closeModal('recompModal');return}
  if(!state.recomp.entries) state.recomp.entries={};
  state.recomp.entries[today]={weight:w||undefined,bf:bf||undefined,notes:notes||undefined};
  if(!state.recomp.xpToday){state.recomp.xpToday=true;awardXP(20,'Medición cuerpo')}
  saveState();closeModal('recompModal');render();
}
function rProgress(){
  const minsToday=DEFAULT_MINIMUMS.filter(m=>['minimum','complete'].includes(getMinimum(m.id).status)).length;
  const prs=Object.keys(state.training?.prs||{}).length;
  return `<div class="sec-head"><div class="sec-title">Progreso</div><div class="sec-sub">Constancia, composición y estadísticas.</div></div>`+
  `<div class="summary-row"><div class="sum-card"><div class="sum-val">${nonZeroStreak()}</div><div class="sum-lbl">No-cero</div></div><div class="sum-card"><div class="sum-val">${minsToday}</div><div class="sum-lbl">Mínimos hoy</div></div><div class="sum-card"><div class="sum-val">${prs}</div><div class="sum-lbl">PRs</div></div></div>`+
  rRecompCard()+
  rStats();
}
function getStateSizeWarningHtml(){
  const bytes=lastStateSizeBytes||estimateStateBytes(state);
  if(bytes<=750*1024)return '';
  return `<div class="settings-card"><div class="settings-card-title">Aviso de datos</div><div class="settings-help">Tus datos están creciendo mucho. Pronto convendrá optimizar el diario en una fase posterior.</div></div>`;
}
function openHabitsEditor(){
  ensureUnifiedState();
  const habHtml=`<div class="settings-card" style="margin-bottom:12px"><div class="settings-card-title">Hábitos diarios</div>${
    HABITS.map(h=>`<div class="settings-row"><div class="settings-meta"><div class="settings-label">${h.emoji} ${h.label}</div></div><button class="settings-toggle ${state.habitSettings[h.id]===false?'':'on'}" onclick="toggleHabitSetting('${h.id}')"></button></div>`).join('')
  }</div>`;
  const minHtml=`<div class="settings-card" style="margin-bottom:12px"><div class="settings-card-title">Mínimos diarios</div>${
    DEFAULT_MINIMUMS.map(m=>`<div class="settings-row"><div class="settings-meta"><div class="settings-label">${m.emoji} ${m.name}</div><div class="settings-help">${m.desc}</div></div><button class="settings-toggle ${state.minimumSettings[m.id]?.active!==false?'on':''}" onclick="toggleMinimumSetting('${m.id}')"></button></div>`).join('')
  }</div>`;
  document.getElementById('habitsEditorContent').innerHTML=habHtml+minHtml;
  openSheet('habitsEditorOverlay');
}
function toggleHabitSetting(id){
  ensureUnifiedState();
  state.habitSettings[id]=state.habitSettings[id]===false?true:false;
  saveState();openHabitsEditor();
}
function toggleMinimumSetting(id){
  ensureUnifiedState();
  if(!state.minimumSettings[id]) state.minimumSettings[id]={active:true};
  state.minimumSettings[id].active=!state.minimumSettings[id].active;
  saveState();openHabitsEditor();
}
function rSettings(){
  ensureUnifiedState();const p=state.profile||{};
  return `<div class="sec-head"><div class="sec-title">Ajustes</div><div class="sec-sub">Configuración personal de la app.</div></div>
  <div class="settings-grid">
    <div class="settings-card"><div class="settings-card-title">Rehab</div>
      <div class="settings-row"><div class="settings-meta"><div class="settings-label">Activa</div><div class="settings-help">${p.rehabEnabled===false?'Oculta sin borrar datos.':'Rutina visible y activa.'}</div></div><button class="settings-toggle ${p.rehabEnabled===false?'':'on'}" aria-pressed="${p.rehabEnabled===false?'false':'true'}" onclick="toggleRehabEnabled()"></button></div>
      <div class="settings-row"><div class="settings-meta"><div class="settings-label">Meta semanal</div><div class="settings-help">Días de rehab por semana.</div></div><div class="settings-control"><select class="settings-select" onchange="updRehabGoal(this.value)">${[3,4,5].map(d=>`<option value="${d}" ${(p.rehabDaysGoal||4)===d?'selected':''}>${d} días</option>`).join('')}</select></div></div>
    </div>
    <div class="settings-card"><div class="settings-card-title">Recordatorios</div>
      <div class="settings-row"><div class="settings-meta"><div class="settings-label">Notificación diaria</div><div class="settings-help">${p.reminderEnabled?'Recordatorio activo.':'Pide permiso al navegador.'}</div></div><button class="settings-toggle ${p.reminderEnabled?'on':''}" onclick="toggleReminder()"></button></div>
      <div class="settings-row"><div class="settings-meta"><div class="settings-label">Hora</div></div><div class="settings-control"><input class="settings-input" type="time" value="${p.reminderTime||'19:00'}" onchange="updReminderTime(this.value)"></div></div>
    </div>
    <div class="settings-card"><div class="settings-card-title">Personalizar</div>
      <div class="settings-row"><div class="settings-meta"><div class="settings-label">Hábitos y mínimos</div><div class="settings-help">Activa o desactiva qué hábitos y mínimos diarios ves cada día.</div></div><button class="settings-action" style="white-space:nowrap;flex-shrink:0" onclick="openHabitsEditor()">Editar</button></div>
    </div>
    ${getStateSizeWarningHtml()}
    <div class="settings-card"><div class="settings-card-title">Aplicación</div>
      <div class="settings-row"><div class="settings-meta"><div class="settings-label">Buscar actualizaciones</div><div class="settings-help">Limpia la caché y recarga con la última versión. Útil tras una actualización.</div></div><button class="settings-action" style="white-space:nowrap;flex-shrink:0" onclick="forceUpdate(this)">Actualizar</button></div>
    </div>
    <div class="settings-card"><div class="settings-card-title">✨ Asistente IA</div>
      <div class="settings-help" style="margin-bottom:8px">Pega la URL de tu Cloudflare Worker para activar el chat IA (botón ✨ flotante). Sin URL, el asistente no funciona.</div>
      <input class="settings-input" style="width:100%;max-width:none" value="${esc(localStorage.getItem('maxer_worker_url')||'')}" placeholder="https://tu-worker.workers.dev" oninput="localStorage.setItem('maxer_worker_url',this.value.trim())">
      <div class="settings-help" style="margin:10px 0 8px">Token de acceso: el mismo <code>APP_TOKEN</code> configurado en el Worker. Protege tu clave de API para que nadie más pueda usar tu asistente.</div>
      <input class="settings-input" type="password" autocomplete="off" style="width:100%;max-width:none" value="${esc(localStorage.getItem('maxer_worker_token')||'')}" placeholder="tu token secreto" oninput="localStorage.setItem('maxer_worker_token',this.value.trim())">
    </div>
    <div class="settings-card"><div class="settings-card-title">Cuenta</div>
      <div class="settings-actions"><button class="settings-action" onclick="document.getElementById('logoutModal').classList.remove('hidden')">Cerrar sesión</button></div>
    </div>
  </div>
  <div class="danger-zone" style="margin-bottom:12px"><div class="danger-title">Zona de peligro</div><div class="danger-btns"><button class="danger-btn" onclick="promptDayReset()">Reset día de hoy</button><button class="danger-btn" onclick="document.getElementById('fullResetModal').classList.remove('hidden')">Reset total</button><button class="danger-btn" onclick="openDeleteAccountModal()">Eliminar cuenta</button></div></div>`;
}
async function forceUpdate(btn){
  if(btn){btn.disabled=true;btn.textContent='Actualizando…';}
  // Guarda los datos antes de recargar (no se borra nada del usuario, solo la caché de archivos)
  try{flushSave();}catch(e){}
  try{
    if('serviceWorker'in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if('caches'in window){
      const keys=await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
    }
  }catch(e){console.warn('[MAXER] forceUpdate:',e);}
  // Recarga forzando red (evita la versión cacheada)
  location.replace(location.pathname+'?u='+Date.now());
}
function checkDailyReminder(){
  if(!state.profile?.reminderEnabled||!state.profile?.reminderTime)return;
  if('Notification'in window&&Notification.permission==='granted'){
    const [hh,mm]=state.profile.reminderTime.split(':').map(Number),now=new Date(),target=new Date();target.setHours(hh,mm,0,0);if(target<=now)target.setDate(target.getDate()+1);
    const ms=target-now;if(ms<864e5)setTimeout(()=>{if(!isNonZeroDay())new Notification('MAXER',{body:'Hoy cuenta aunque sea mínimo. Haz acto de presencia.',icon:'/icon-192.png'})},ms);
  }
}
function retryPendingCloudSave(){
  if(currentUser&&pendingCloudSave&&navigator.onLine)fsWrite(pendingCloudSave);
}
window.addEventListener('offline',()=>setSyncStatus('offline','Sin conexión'));
window.addEventListener('online',()=>{setSyncStatus('saving','Reconectando...');retryPendingCloudSave();});

// ══ RECOMPOSICIÓN FÍSICA ══════════════════════════════════════
function recompEntries(){ensureUnifiedState();return state.recomp.entries}
function recompMeasures(){ensureUnifiedState();return state.recomp.measures}
function recompGoal(){ensureUnifiedState();return state.recomp.goal}

function saveRecompEntry(){
  ensureUnifiedState();
  const w=parseFloat(document.getElementById('rcWeight')?.value||0);
  const bf=parseFloat(document.getElementById('rcBF')?.value||0);
  if(!w&&!bf){alert('Introduce al menos el peso o el % de grasa.');return}
  const date=td();
  const existing=recompEntries()[date]||{};
  recompEntries()[date]={...existing,weight:w||existing.weight||0,bf:bf||existing.bf||0,ts:Date.now()};
  if(!recompGoal().startDate){recompGoal().startDate=date;recompGoal().startWeight=w||92;recompGoal().startBF=bf||16}
  if(!state.recomp.xpToday){state.recomp.xpToday=true;awardXP(20,'⚖️ Registro corporal')}
  checkAch();saveState();render();
}

function saveRecompMeasures(){
  ensureUnifiedState();
  const waist=parseFloat(document.getElementById('rcWaist')?.value||0);
  const chest=parseFloat(document.getElementById('rcChest')?.value||0);
  const arm=parseFloat(document.getElementById('rcArm')?.value||0);
  if(!waist&&!chest&&!arm){alert('Introduce al menos una medida.');return}
  const date=td();
  recompMeasures()[date]={waist:waist||0,chest:chest||0,arm:arm||0,ts:Date.now()};
  if(!state.recomp.xpToday){state.recomp.xpToday=true;awardXP(20,'📏 Medidas corporales')}
  else awardXP(10,'📏 Medidas');
  saveState();render();
}

function calcTDEE(weight,height,age,activity){
  const bmr=10*weight+6.25*height-5*age+5;
  return Math.round(bmr*activity);
}

function rRecomp(){
  ensureUnifiedState();
  const entries=recompEntries();
  const goal=recompGoal();
  const measures=recompMeasures();
  const sortedDates=Object.keys(entries).sort();
  const lastEntry=sortedDates.length?entries[sortedDates[sortedDates.length-1]]:{};
  const curWeight=lastEntry.weight||goal.startWeight||92;
  const curBF=lastEntry.bf||goal.startBF||16;
  const totalEntries=sortedDates.length;

  const weightLost=Math.max(0,parseFloat(((goal.startWeight||92)-curWeight).toFixed(1)));
  const weightToLose=Math.max(0,(goal.startWeight||92)-(goal.targetWeight||85));
  const weightPct=weightToLose>0?Math.min(weightLost/weightToLose*100,100):0;
  const bfDrop=Math.max(0,parseFloat(((goal.startBF||16)-curBF).toFixed(1)));
  const bfToDrop=Math.max(0,(goal.startBF||16)-(goal.targetBF||11));
  const bfPct=bfToDrop>0?Math.min(bfDrop/bfToDrop*100,100):0;

  const height=190,age=20,activity=1.55;
  const tdee=calcTDEE(curWeight,height,age,activity);
  const targetKcal=tdee-350;
  const proteinG=Math.round(curWeight*2.0);
  const carbsG=Math.max(0,Math.round((targetKcal-proteinG*4-70*9)/4));
  const fatsG=70;

  const last7=sortedDates.slice(-7).map(d=>entries[d].weight||0).filter(v=>v>0);
  const maxW=last7.length?Math.max(...last7)+1:95;
  const minW=last7.length?Math.min(...last7)-1:85;
  const chartRange=maxW-minW||5;

  function weightChart(vals){
    if(!vals.length)return'<div class="empty-chart">Sin datos aún — registra tu primer peso</div>';
    const W=320,H=70,barW=Math.min(36,Math.floor((W-(vals.length-1)*6)/vals.length)),gap=vals.length>1?(W-barW*vals.length)/(vals.length-1):0;
    let bars='',labels='',pts=[];
    vals.forEach((v,i)=>{
      const x=i*(barW+gap);
      const pct=chartRange>0?(v-minW)/chartRange:0.5;
      const bh=Math.max(pct*H,4);
      const by=H-bh;
      pts.push({x:x+barW/2,cy:by});
      bars+=`<rect x="${x}" y="${by}" width="${barW}" height="${bh}" rx="5" fill="url(#rcG)"/>`;
      labels+=`<text x="${x+barW/2}" y="${by-4}" text-anchor="middle" font-size="9" font-weight="700" fill="#1e3a5f" font-family="JetBrains Mono,monospace">${v}</text>`;
    });
    let line='';
    if(pts.length>1){const d=pts.map((p,i)=>i===0?`M${p.x},${p.cy}`:`L${p.x},${p.cy}`).join(' ');line=`<path d="${d}" fill="none" stroke="#0f4c81" stroke-width="1.5" stroke-dasharray="4 2" opacity="0.4"/>`}
    return`<svg viewBox="0 0 ${W} ${H+14}" width="100%" style="overflow:visible"><defs><linearGradient id="rcG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1e3a5f"/><stop offset="100%" stop-color="#3b82f6" stop-opacity="0.5"/></linearGradient></defs>${bars}${line}${labels}</svg>`;
  }

  const todayEntry=entries[td()]||{};
  const todayMeasure=measures[td()]||{};

  return `<div class="sec-head"><div class="sec-title">⚖️ Recomposición Física</div><div class="sec-sub">Peso · Grasa · Medidas · Plan personalizado</div></div>`+

`<div class="recomp-hero"><div class="recomp-hero-title">Peso actual</div><div class="recomp-hero-val">${curWeight} <span style="font-size:16px;opacity:.7">kg</span></div><div class="recomp-hero-sub">Objetivo: ${goal.targetWeight} kg · Faltan ${Math.max(0,curWeight-goal.targetWeight).toFixed(1)} kg · ${totalEntries} registros</div></div>`+

`<div class="recomp-metrics-grid"><div class="recomp-metric"><div class="recomp-metric-val">${curBF}<span style="font-size:11px">%</span></div><div class="recomp-metric-lbl">Grasa corp.</div></div><div class="recomp-metric"><div class="recomp-metric-val" style="color:var(--green2)">${weightLost>0?'-'+weightLost:'0'} kg</div><div class="recomp-metric-lbl">Perdidos</div></div><div class="recomp-metric"><div class="recomp-metric-val" style="color:var(--orange)">${Math.round(weightPct)}%</div><div class="recomp-metric-lbl">Progreso</div></div></div>`+

`<div class="progress-towards"><div style="font-size:12px;font-weight:800;margin-bottom:10px">📍 Hacia el objetivo</div><div class="goal-bar-row"><div class="goal-bar-label"><span>Peso: ${curWeight}kg → ${goal.targetWeight}kg</span><span style="color:var(--blue)">${Math.round(weightPct)}%</span></div><div class="goal-bar-track"><div class="goal-bar-fill" style="width:${weightPct}%;background:linear-gradient(90deg,#1e3a5f,#3b82f6)"></div></div></div><div class="goal-bar-row" style="margin-bottom:0"><div class="goal-bar-label"><span>Grasa: ${curBF}% → ${goal.targetBF}%</span><span style="color:var(--green2)">${Math.round(bfPct)}%</span></div><div class="goal-bar-track"><div class="goal-bar-fill" style="width:${bfPct}%;background:linear-gradient(90deg,var(--green),var(--green2))"></div></div></div></div>`+

`<div class="recomp-form-card"><div class="recomp-form-title">📝 Registro de hoy${todayEntry.weight?` <span style="color:var(--green2);font-size:11px">✓ guardado</span>`:''}</div><div class="recomp-input-row"><div class="recomp-field"><div class="recomp-label">Peso (kg)</div><input class="recomp-input" id="rcWeight" type="number" step="0.1" min="50" max="200" placeholder="${curWeight}" value="${todayEntry.weight||''}"></div><div class="recomp-field"><div class="recomp-label">% Grasa</div><input class="recomp-input" id="rcBF" type="number" step="0.1" min="3" max="50" placeholder="${curBF}" value="${todayEntry.bf||''}"></div></div><button class="recomp-save-btn" onclick="saveRecompEntry()">Guardar registro · +20 XP ⚡</button></div>`+

`<div class="recomp-chart-card"><div class="recomp-chart-title">📈 Evolución del peso</div><div class="recomp-chart-sub">Últimos ${last7.length} registros · kg</div>${weightChart(last7)}</div>`+

`<div class="measures-card"><div class="measures-title">📏 Medidas corporales${todayMeasure.waist?` <span style="color:var(--green2);font-size:11px">✓ guardadas</span>`:''}</div><div class="measures-row"><div class="recomp-field"><div class="recomp-label">Cintura (cm)</div><input class="recomp-input" id="rcWaist" type="number" step="0.5" placeholder="${todayMeasure.waist||'83'}" value="${todayMeasure.waist||''}"></div><div class="recomp-field"><div class="recomp-label">Pecho (cm)</div><input class="recomp-input" id="rcChest" type="number" step="0.5" placeholder="${todayMeasure.chest||'105'}" value="${todayMeasure.chest||''}"></div><div class="recomp-field"><div class="recomp-label">Brazo (cm)</div><input class="recomp-input" id="rcArm" type="number" step="0.5" placeholder="${todayMeasure.arm||'38'}" value="${todayMeasure.arm||''}"></div></div><button class="recomp-save-btn" style="background:linear-gradient(135deg,#065f46,#047857)" onclick="saveRecompMeasures()">Guardar medidas · +10 XP 📏</button></div>`+

`<div class="deficit-card"><div class="deficit-title">🔢 Plan calórico personalizado</div><div class="deficit-grid"><div class="deficit-stat"><div class="deficit-stat-val">${tdee}</div><div class="deficit-stat-lbl">TDEE kcal</div></div><div class="deficit-stat"><div class="deficit-stat-val">${targetKcal}</div><div class="deficit-stat-lbl">Objetivo/día</div></div><div class="deficit-stat"><div class="deficit-stat-val">${proteinG}g</div><div class="deficit-stat-lbl">Proteína</div></div><div class="deficit-stat"><div class="deficit-stat-val">−350</div><div class="deficit-stat-lbl">Déficit</div></div></div><div class="deficit-tip"><strong>Para ${curWeight}kg · 190cm · 20 años · actividad moderada:</strong><br>🥩 Proteína ${proteinG}g · 🍚 Carbos ${carbsG}g · 🥑 Grasas ${fatsG}g<br><span style="opacity:.8">Ajusta carbos ±20g según el resultado semanal. Si pierdes más de 0.7kg/sem, come más.</span></div></div>`+

`<div class="plan-card"><div class="plan-title">📅 Plan 20 semanas · ${goal.startWeight||92}kg → ${goal.targetWeight}kg</div><div class="plan-week-row"><div class="plan-week-num">S1–2</div><div class="plan-week-content"><div class="plan-week-title">Adaptación calórica</div><div class="plan-week-desc">Instala el déficit de 300–400 kcal. Pesar cada mañana en ayunas. Objetivo: 0.3–0.5 kg/sem. Fuerza 3 días/sem (no cardio sustitutivo).</div></div></div><div class="plan-week-row"><div class="plan-week-num">S3–6</div><div class="plan-week-content"><div class="plan-week-title">Primeras pérdidas visibles</div><div class="plan-week-desc">Primer control de medidas. Si el peso no baja en 2 semanas, reduce carbos 20g. La mandíbula empieza a definirse cerca de 89kg.</div></div></div><div class="plan-week-row"><div class="plan-week-num">S7–14</div><div class="plan-week-content"><div class="plan-week-title">Fase V-taper</div><div class="plan-week-desc">A ~87kg el V-taper se hace visible. Continúa hipertrofia de hombros y espalda — amplifica la ilusión óptica. Medidas cada 2 semanas.</div></div></div><div class="plan-week-row"><div class="plan-week-num">S15–20</div><div class="plan-week-content"><div class="plan-week-title">Objetivo 85kg · 11% BF</div><div class="plan-week-desc">Mandíbula definida, six-pack parcial visible. Si llegas a 85kg antes, mantén 2–4 semanas antes de decidir continuar o hacer recomp.</div></div></div></div>`+

`<div class="info-box" style="margin-bottom:14px">💡 Informe PSL: bajar del 15–17% al 10–12% BF es la mayor palanca de impacto visual. Revela mandíbula, pómulos y V-taper sin cirugía.</div>`;
}

// ===== Bloque 2 de 3 (extraído de index.html) =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/service-worker.js').catch(function () {});
  });
}

// ===== Bloque 3 de 3 (extraído de index.html) =====
// ══ AI CHAT ═══════════════════════════════════════════════
let aiMessages=[];
function openAIChat(){
  document.getElementById('aiOverlay').classList.remove('hidden');
  renderAIMessages();
  setTimeout(()=>document.getElementById('aiInput')?.focus(),200);
}
function closeAIChat(){document.getElementById('aiOverlay').classList.add('hidden')}
function useAISuggestion(text){
  document.getElementById('aiSuggestions').style.display='none';
  const inp=document.getElementById('aiInput');
  if(inp){inp.value=text;inp.focus()}
}
function buildAIContext(){
  ensureUnifiedState();
  const g=state.recomp?.goal||{};
  const wHistory=Object.entries(state.history||{}).slice(-7).map(([d,v])=>`${d}: ${v.xp||0}XP${v.nonZero?' activo':''}`).join(', ')||'sin datos';
  const seriesHoy=Object.values(state.general||{}).flat().filter(Boolean).length;
  return `Usuario: ${state.profile?.name||'Usuario'}.
Datos: peso ${g.startWeight||92}kg, altura 190cm, edad 20 años, BF ~${g.startBF||16}%.
Meta: llegar a ${g.targetWeight||85}kg y ${g.targetBF||11}% BF.
Rehab ACL: semana ${state.rehabWeek||1}/4.
Hoy: ${seriesHoy} series de entrenamiento completadas, racha ${state.streak||0} días, XP total ${state.xp||0}.
Historial (7d): ${wHistory}.`;
}
function mdFormat(s){
  // Escapa HTML y luego aplica un markdown mínimo: **negrita**, *cursiva* y saltos de línea
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1<em>$2</em>')
    .replace(/\n/g,'<br>');
}
function renderAIMessages(){
  const c=document.getElementById('aiMessages');if(!c)return;
  if(!aiMessages.length){
    c.innerHTML='<div class="ai-msg ai">¡Hola! Soy tu asistente de fitness. Puedo ayudarte con tu plan de entrenamiento, nutrición, rehab o responder cualquier duda. ¿En qué te ayudo hoy?</div>';
    return;
  }
  c.innerHTML=aiMessages.map(m=>`<div class="ai-msg ${m.role==='user'?'user':'ai'}">${mdFormat(m.content)}</div>`).join('');
  c.scrollTop=c.scrollHeight;
}
async function sendAIMsg(){
  const inp=document.getElementById('aiInput');
  const text=(inp?.value||'').trim();if(!text)return;
  inp.value='';
  document.getElementById('aiSuggestions').style.display='none';
  const workerUrl=(localStorage.getItem('maxer_worker_url')||'').trim();
  const workerToken=(localStorage.getItem('maxer_worker_token')||'').trim();
  if(!workerUrl){
    aiMessages.push({role:'user',content:text});
    aiMessages.push({role:'assistant',content:'⚠️ Para usar el asistente IA, ve a Ajustes y configura la URL de tu Cloudflare Worker.\n\nSi aún no tienes Worker, consulta las instrucciones incluidas en el zip.'});
    renderAIMessages();return;
  }
  aiMessages.push({role:'user',content:text});
  renderAIMessages();
  const c=document.getElementById('aiMessages');
  const th=document.createElement('div');th.className='ai-msg thinking';th.id='aiThinking';th.textContent='Pensando...';
  c?.appendChild(th);if(c)c.scrollTop=c.scrollHeight;
  try{
    const res=await fetch(workerUrl,{
      method:'POST',
      headers:{'Content-Type':'application/json',...(workerToken?{'Authorization':'Bearer '+workerToken}:{})},
      body:JSON.stringify({context:buildAIContext(),messages:aiMessages.filter(m=>m.role!=='system')})
    });
    const data=await res.json();
    const reply=data.content||data.reply||data.text||'Sin respuesta del asistente.';
    aiMessages.push({role:'assistant',content:reply});
  }catch(e){
    aiMessages.push({role:'assistant',content:'Error conectando con el asistente. Verifica que la URL del Worker sea correcta y que el Worker esté desplegado.'});
  }
  document.getElementById('aiThinking')?.remove();
  renderAIMessages();
}