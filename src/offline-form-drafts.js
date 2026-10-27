// Forms exist only in the current online view. No listeners persist input and
// no previously stored form is restored after navigation or reconnection.
export function installOperationalDrafts() {
  return {restore:async()=>false,clear:async()=>{},checkpoint:()=>null,
    clearSubmitted:async()=>{},flush:async()=>[],destroy(){}};
}
