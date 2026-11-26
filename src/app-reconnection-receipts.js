const publishedReconnectionRelease=1795692452458;
const installationIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[48][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const idVersionOffset=14;

export function isRequiredReconnection(request) {
 return request?.target==='FA'&&request.minimumRelease===publishedReconnectionRelease;
}

export function reconnectionStorageKey(uid,deviceId) {
 return 'sahmt-access-update-20261126:'+uid+':'+deviceId;
}

export function hasVerifiedReconnection(storage,uid,deviceId) {
 try{return Boolean(uid&&deviceId&&storage?.getItem(reconnectionStorageKey(uid,deviceId))==='verified');}
 catch{return false;}
}

// App installations use UUIDv4. A paired UUIDv8 preserves an independent,
// server-timestamped reconnection receipt under the existing installation rules.
export function reconnectionReceiptId(deviceId) {
 if(!installationIdPattern.test(deviceId||'')||deviceId[idVersionOffset]!=='4')return '';
 return deviceId.slice(0,idVersionOffset)+'8'+deviceId.slice(idVersionOffset+1);
}

export function isReconnectionReceipt(device) {
 const id=device?.deviceId;
 return device?.target==='FA'&&installationIdPattern.test(id||'')&&id[idVersionOffset]==='8';
}

export function reconnectionDevices(rows,target) {
 const receipts=new Map(rows.filter(isReconnectionReceipt).map(receipt=>[receipt.deviceId,receipt]));
 return rows.filter(device=>device.target===target&&!isReconnectionReceipt(device))
  .map(device=>({device,receipt:receipts.get(reconnectionReceiptId(device.deviceId))}));
}
