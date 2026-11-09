const HOME_WELCOME_TIME_ZONE='America/Sao_Paulo';
const HOME_WELCOME_MESSAGES=[
  'Conexão, cuidado e organização para sua rotina.',
  'Um dia organizado começa com propósito e colaboração.',
  'Cuidado e atenção em cada detalhe da nossa jornada.',
  'Juntos, fortalecemos uma rotina mais leve e acolhedora.',
  'Boas ideias e trabalho em equipe movem o nosso dia.',
  'Acolher, colaborar e cuidar: um propósito compartilhado.',
  'Organização e compromisso para fazer a diferença, juntos.'
];
const homeWelcomeClock=new Intl.DateTimeFormat('en-CA',{
  timeZone:HOME_WELCOME_TIME_ZONE,
  year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
});
const HOME_WELCOME_DAY_MS=24*60*60*1000;

function homeWelcomeClockParts(now){
  return Object.fromEntries(homeWelcomeClock.formatToParts(now).map(({type,value})=>[type,value]));
}

export function getDailyHomeWelcomeMessage(now=new Date()){
  const parts=homeWelcomeClockParts(now);
  const ordinal=Math.floor(Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day))/HOME_WELCOME_DAY_MS)-(Number(parts.hour)<6?1:0);
  const index=((ordinal%HOME_WELCOME_MESSAGES.length)+HOME_WELCOME_MESSAGES.length)%HOME_WELCOME_MESSAGES.length;
  return HOME_WELCOME_MESSAGES[index];
}

export function millisecondsUntilHomeWelcomeChange(now=new Date()){
  const parts=homeWelcomeClockParts(now),hour=Number(parts.hour),minute=Number(parts.minute),second=Number(parts.second);
  const hoursUntilSix=hour<6?6-hour:30-hour;
  return Math.max(1,((hoursUntilSix*60-minute)*60-second)*1000-now.getUTCMilliseconds());
}
