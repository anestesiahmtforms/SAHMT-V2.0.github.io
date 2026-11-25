import {WORK_SUNDAY, SUNDAY_WORK_OPTIONS} from './registration-domain.js';

const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const isRegistrationList = field => ['checks','work-grid','multi-select'].includes(field.type);

function birthDateField(field, value) {
 return `<div class="reg-field" data-field="birthDate">
  <label for="reg-birth-date">${h(field.label)}${field.required ? ' *' : ''}</label>
  <div class="reg-birth-date-row">
   <input id="reg-birth-date" name="birthDate" type="date" value="${h(value)}"${field.required ? ' required' : ''}>
   <div class="reg-age" data-reg-age hidden>
    <strong id="reg-age-title">IDADE ATUAL</strong>
    <output for="reg-birth-date" aria-labelledby="reg-age-title" data-reg-age-value></output>
   </div>
  </div>
 </div>`;
}

function workGrid(field, value) {
 const selected = Array.isArray(value) ? value : [];
 const previousDays = field.options.filter(([day]) => selected.includes(day)).map(([,label]) => label);
 return `<fieldset class="reg-work-grid" data-field="${field.id}">
  <legend>${h(field.label)}${field.required?' *':''}</legend>
  ${previousDays.length ? `<p class="reg-help">Dias do cadastro anterior: ${h(previousDays.join(', '))}. Marque a frequência e o turno de cada dia.</p>` : ''}
  <table><thead><tr><th scope="col">Dia</th>${field.columns.map(([,label]) => `<th scope="col"><span>${h(label)}</span></th>`).join('')}</tr></thead>
  <tbody>${field.options.map(([day,label]) => `<tr><th scope="row">${h(label)}</th>${field.columns.map(([option,column]) => {
   const key = `${day}:${option}`;
   const sunday = day === WORK_SUNDAY;
   if (sunday && !SUNDAY_WORK_OPTIONS.includes(option)) {
    const previous = selected.includes(key) ? `<input type="hidden" name="${field.id}" value="${key}">` : '';
    return `<td>${previous}<span aria-hidden="true">—</span></td>`;
   }
   const checked = selected.includes(key) && !(option === 'WEEKLY' && selected.includes(day + ':FORTNIGHTLY'));
   return `<td><label><input type="checkbox" name="${field.id}" value="${key}" aria-label="${h(`${label}, ${column}`)}"${checked ? ' checked' : ''}></label></td>`;
  }).join('')}</tr>`).join('')}</tbody></table>
  <div class="reg-schedule-participation">
   <strong id="reg-schedule-participation-title">ÍNDICE DE PARTICIPAÇÃO NA ESCALA</strong>
   <output aria-labelledby="reg-schedule-participation-title" aria-describedby="reg-schedule-participation-help" data-reg-schedule-participation></output>
   <small class="reg-help" id="reg-schedule-participation-help" data-reg-schedule-participation-help></small>
  </div>
 </fieldset>`;
}

function multiSelect(field, value) {
 const selected = Array.isArray(value) ? value : [];
 return `<fieldset class="reg-multi-select" data-field="${field.id}">
  <legend>${h(field.label)}${field.required?' *':''}</legend>
  ${typeof value === 'string' && value ? `<p class="reg-help">Cadastro anterior: ${h(value)}</p>` : ''}
  <div class="reg-multi-options">
  ${field.options.map(([id,label]) => `<label><input type="checkbox" name="${field.id}" value="${id}"${selected.includes(id) ? ' checked' : ''}>${h(label)}</label>`).join('')}
  </div>
 </fieldset>`;
}

export function registrationField(f,value){const help=f.help?`<small>${h(f.help)}</small>`:'';const required=f.required?' required':'';let control;if(f.type==='checks'){const list=Array.isArray(value)?value:[];return `${f.section?'<h3 class="reg-section">'+h(f.section)+'</h3>':''}<fieldset class="reg-checks" data-field="${f.id}"><legend>${h(f.label)}${f.required?' *':''}</legend>${f.options.map(([id,label])=>`<label><input type="checkbox" name="${f.id}" value="${id}" ${list.includes(id)?'checked':''}>${h(label)}</label>`).join('')}${help}</fieldset>`;}
 if(f.type==='work-grid')return workGrid(f,value);
 if(f.type==='multi-select')return multiSelect(f,value);
 if(f.id==='birthDate')return birthDateField(f,value);
 if(f.type==='textarea')control=`<textarea name="${f.id}" rows="3" maxlength="${f.max||3000}"${required}>${h(value||'')}</textarea>`;else if(f.options)control=`<select name="${f.id}"${required}><option value="">${f.required?'Selecione':'Selecione, se desejar informar'}</option>${f.options.map(([id,label])=>`<option value="${id}"${value===id?' selected':''}>${h(label)}</option>`).join('')}</select>`;else control=`<input name="${f.id}" type="${f.type}" value="${h(value||'')}" maxlength="${f.max||200}"${f.inputmode?' inputmode="'+f.inputmode+'"':''}${required}>`;
 return `${f.section?'<h3 class="reg-section">'+h(f.section)+'</h3>':''}<label class="reg-field" data-field="${f.id}"${f.when?' data-conditional="'+f.when.join(':')+'"':''}>${h(f.label)}${f.required?' *':''}${control}${help}</label>`;
}
