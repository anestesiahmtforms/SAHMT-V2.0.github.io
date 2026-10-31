const svg=body=>`<svg class="year-end-option-icon" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">${body}</svg>`;
const icons={
 natal:svg('<path d="M10 2v6M23 2v9" stroke="#b18b31" stroke-width="2"/><path d="M7 7h6v4H7zM20 10h6v4h-6z" fill="#d5aa44"/><circle cx="10" cy="18" r="9" fill="#b92f42"/><circle cx="23" cy="23" r="8" fill="#16815b"/><path d="M3 18h14M16 23h14" stroke="#f9df8b" stroke-width="2"/><path d="M7 12c-2 1-3 3-3 5M21 17c-2 1-3 2-3 4" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'),
 reveillon:svg('<path d="m17 24 6-10 4 4-10 6Z" fill="#da6b45"/><path d="m23 14 3-3 4 4-3 3Z" fill="#3779bb"/><path d="m17 24-5 6M20 26l-2 4" stroke="#e6aa28" stroke-width="2" stroke-linecap="round"/><path d="M10 3v4M10 15v4M2 11h4M14 11h4M4 5l3 3M13 14l3 3M4 17l3-3M13 8l3-3" stroke="#c49a26" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="11" r="2" fill="#9c4eb4"/>'),
 carnaval:svg('<path d="m3 9 13 3 13-3v10c-1 7-8 8-13 3-5 5-12 4-13-3V9Z" fill="#8751ad"/><path d="m16 12 13-3v10c-1 7-8 8-13 3V12Z" fill="#168a75"/><path d="m3 9 13 3 13-3M16 12v10" stroke="#e5b345" stroke-width="2"/><path d="m6 16 6 1-2 4c-3 0-4-2-4-5Zm20 0-6 1 2 4c3 0 4-2 4-5Z" fill="#fff5d9"/><path d="m5 5 3 4M13 3l2 7M24 4l-3 6" stroke="#deaa36" stroke-width="2" stroke-linecap="round"/>')
};
export const yearEndOptionIcon=id=>icons[id]||'';
