export function participantFields(participant) {
  if(!participant?.uid||!/^[a-f0-9]{64}$/.test(participant.categoryKey))throw Error('SESSION_REQUIRED');
  return {respondent_uid:{stringValue:participant.uid},category_key:{stringValue:participant.categoryKey}};
}
export async function participantAuthorization(participant) {
  participantFields(participant);
  const token=await participant.getToken();
  if(!token)throw Error('SESSION_REQUIRED');
  return `Bearer ${token}`;
}
