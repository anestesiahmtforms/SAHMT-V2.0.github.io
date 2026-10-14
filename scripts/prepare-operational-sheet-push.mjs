import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

// Private handoff only. Never publishes, prints a secret or modifies Firebase.
const directory=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.local','share'),'SAHMT','operational-sheet-push-v1');
fs.mkdirSync(directory,{recursive:true,mode:0o700});
const file=path.join(directory,'worker-secret.private.json');
let secret;
if(fs.existsSync(file))secret=JSON.parse(fs.readFileSync(file,'utf8')).OPERATIONAL_SHEETS_HMAC_SECRET;
else {
  secret=randomBytes(32).toString('base64url');
  fs.writeFileSync(file,JSON.stringify({OPERATIONAL_SHEETS_HMAC_SECRET:secret}),{mode:0o600,flag:'wx'});
}
if(!/^[A-Za-z0-9_-]{43}$/.test(secret||''))throw Error('CONTROLE_SEGREDO_LOCAL_INVALIDO');
const installer=`// Private installer. Do not copy to a public repository.
function instalarEnvioUnitarioPlanilhaV1() {
  oscOwner_();
  return oscLocked_(function() {
    const p=sahmtV2Properties_();
    if(p.getProperty(OSC.ready)!=='YES'||p.getProperty(OSC.enabled)!=='YES')oscFail_('CONTROLE_CARGA_INICIAL_AUSENTE');
    oscBook_();
    const secret=${JSON.stringify(secret)};
    const previous=p.getProperty('SAHMT_OPERATIONAL_PUSH_HMAC_SECRET');
    if(previous&&previous!==secret)oscFail_('CONTROLE_SEGREDO_DIVERGENTE');
    p.setProperty('SAHMT_OPERATIONAL_PUSH_HMAC_SECRET',secret);
    p.setProperty('SAHMT_OPERATIONAL_PUSH_ENABLED','YES');
    cancelarIntervalosPlanilhaV1();
    return oscResult_('CONTROLE_ENVIO_UNITARIO_CONFIGURADO',{firestoreReads:0,firestoreWrites:0,periodicReads:false});
  });
}
`;
fs.writeFileSync(path.join(directory,'InstallOperationalSheetPush.gs'),installer,{mode:0o600});
console.log(JSON.stringify({code:'CONTROLE_PACOTE_PRIVADO_PREPARADO',secretPrinted:false,remoteChanges:false}));
