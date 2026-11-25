// In-page confirm / prompt / notice dialogs.
//
// Native window.confirm(), window.prompt() and window.alert() return false
// / null WITHOUT SHOWING ANYTHING in browsers that suppress JS dialogs
// (Android WebView without a WebChromeClient, headless/automated browsers).
// Any user action gated on one then silently does nothing — that is how the
// trial-checkout buttons died on every plan (Nov 24, 2026: the click did
// nothing at all, no dialog, no error, no navigation, in automation AND
// when the user clicked himself). These helpers render the dialog in the
// page instead, so they work everywhere the page itself renders.
//
// Only touches document at call time, so node tests can import this module
// with a stubbed document. One dialog at a time: opening a second dialog
// dismisses the current one as cancelled (same supersede behaviour the
// checkout panel had).
let current=null;
const OVERLAY_STYLE='position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;box-sizing:border-box;';
const DIALOG_STYLE='background:#fff;color:#0f172a;border-radius:12px;padding:20px;max-width:420px;width:100%;box-shadow:0 12px 32px rgba(15,23,42,.25);box-sizing:border-box;';
const PRIMARY_STYLE='background:#1d4ed8;color:#fff;border:none;border-radius:8px;padding:10px 16px;cursor:pointer;font:inherit;';
const SECONDARY_STYLE='background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:8px;padding:10px 16px;cursor:pointer;font:inherit;';
const INPUT_STYLE='width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;font:inherit;margin:8px 0;';
function dismiss(value){if(!current)return;const {overlay,resolve}=current;current=null;if(overlay.remove)overlay.remove();else if(overlay.parentNode)overlay.parentNode.removeChild(overlay);document.removeEventListener('keydown',onKey);resolve(value);}
function onKey(event){if(event.key==='Escape')dismiss(null);}
function openDialog({message,label='Confirm',input=null,confirmLabel='Confirm',cancelLabel='Cancel',expected=null}){
 if(current)dismiss(null);
 return new Promise(resolve=>{
  const overlay=document.createElement('div');overlay.style.cssText=OVERLAY_STYLE;overlay.setAttribute('role','alertdialog');overlay.setAttribute('aria-label',label);
  const dialog=document.createElement('div');dialog.style.cssText=DIALOG_STYLE;
  const text=document.createElement('p');text.textContent=message;dialog.append(text);
  let field=null,error=null;
  if(input){field=document.createElement('input');field.type='text';if(input.placeholder)field.placeholder=input.placeholder;field.style.cssText=INPUT_STYLE;dialog.append(field);error=document.createElement('p');error.style.cssText='color:#b91c1c;margin:4px 0 0;';error.setAttribute('role','alert');error.hidden=true;dialog.append(error);}
  const row=document.createElement('div');row.style.cssText='display:flex;gap:12px;justify-content:flex-end;margin-top:16px;';
  const confirmButton=document.createElement('button');confirmButton.type='button';confirmButton.textContent=confirmLabel;confirmButton.style.cssText=PRIMARY_STYLE;
  const cancelButton=document.createElement('button');cancelButton.type='button';cancelButton.textContent=cancelLabel;cancelButton.style.cssText=SECONDARY_STYLE;
  confirmButton.onclick=()=>{
   if(field){
    const value=field.value.trim();
    if(expected!==null&&value!==expected){error.textContent='That does not match. Type '+expected+' exactly to continue.';error.hidden=false;field.focus();return;}
    if(expected===null&&!value){error.textContent='Enter a value to continue.';error.hidden=false;field.focus();return;}
    dismiss(value);return;
   }
   dismiss(true);
  };
  cancelButton.onclick=()=>dismiss(input?null:false);
  row.append(cancelButton,confirmButton);dialog.append(row);
  overlay.append(dialog);
  overlay.addEventListener('click',event=>{if(event.target===overlay)dismiss(input?null:false);});
  document.addEventListener('keydown',onKey);
  current={overlay,resolve};
  document.body.append(overlay);
  if(field)field.focus();else confirmButton.focus();
 });
}
// Confirm/cancel dialog. Resolves true on Confirm, false on Cancel,
// backdrop click or Escape. Replaces window.confirm().
export function askConfirm(message,{confirmLabel='Confirm',cancelLabel='Cancel'}={}){
 return openDialog({message,confirmLabel,cancelLabel}).then(value=>value===true);
}
// Text-input dialog. With {expected} the typed value must match exactly
// (a mismatch shows an inline error and keeps the dialog open); without
// it an empty value does the same. Resolves the typed value, or null on
// Cancel / backdrop click / Escape. Replaces window.prompt().
export function askText(message,{confirmLabel='Continue',cancelLabel='Cancel',placeholder='',expected=null}={}){
 return openDialog({message,input:{placeholder},confirmLabel,cancelLabel,expected});
}
// One-button notice. Resolves when dismissed. Replaces window.alert().
export function showNotice(message,{label='Notice'}={}){
 return openDialog({message,label,confirmLabel:'OK',cancelLabel:'Dismiss'}).then(()=>{});
}
