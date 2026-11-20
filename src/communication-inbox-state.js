let owner='',unread;

export function inboxUnread(uid){return uid&&owner===uid?unread:undefined;}
export function setInboxUnread(uid,value){if(uid){owner=uid;unread=Boolean(value);}}
