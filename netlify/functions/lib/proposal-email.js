// Presentation only: never infer, regenerate or approve proposal claims.
const D = require('docx');
// Correct only the known service-name typo, never generic occurrences of "Bid".
const normalizeBrand = text => text.replace(/\bTenderCrestBid[ \t]+AI\b/gi, 'TenderCrest AI');
// JSON can contain lone surrogates/noncharacters that are invalid in Word XML.
const validXMLText = text => !/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/u.test(text) &&
  !Array.from(text).some(char => { const n=char.codePointAt(0); return n>=0xd800&&n<=0xdfff; });
const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const invalid = () => { const error = new Error('Proposal structure exceeds delivery limits'); error.statusCode = 413; throw error; };
function inline(text) {
  // Only explicit strong/emphasis markers are interpreted. HTML and URLs stay text.
  return text.split(/(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*)/g).filter(Boolean).map(value => {
    if (/^(\*\*|__)/.test(value)) return {text:value.slice(2,-2),bold:true};
    if (value.startsWith('*') && value.endsWith('*')) return {text:value.slice(1,-1),italics:true};
    return {text:value};
  });
}
function parse(message) {
  const lines = message.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 10000) invalid();
  const blocks = []; let paragraph = [];
  const push = block => { if (blocks.length >= 2000) invalid(); blocks.push(block); };
  const flush = () => { if (paragraph.length) push({type:'paragraph',text:paragraph.join('\n')}); paragraph = []; };
  const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    const header = trimmed.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
    const boldTitle = trimmed.match(/^\*\*([^*]+)\*\*:?$/);
    const sectionTitle = /^(?:\d{1,3}[.)]\s+)?(?:executive summary|technical (?:approach|proposal)|management (?:approach|plan)|implementation (?:plan|schedule)|company (?:overview|qualifications)|past performance|pricing(?: and assumptions)?|assumptions(?: and dependencies)?|compliance matrix|risks(?: and mitigations)?|next steps|conclusion):?$/i.test(trimmed);
    // Tables require an explicit Markdown divider; arbitrary pipe text stays intact.
    const divider = i+1 < lines.length && trimmed.includes('|') && cells(lines[i+1]).every(x => /^:?-{3,}:?$/.test(x));
    if (divider && cells(trimmed).length === cells(lines[i+1]).length) {
      flush(); const rows = [cells(trimmed)]; i++;
      while (i+1 < lines.length && lines[i+1].trim().includes('|') && cells(lines[i+1]).length === rows[0].length) rows.push(cells(lines[++i]));
      if (rows[0].length > 20 || rows.length > 500 || rows.some(row => row.some(cell => cell.length > 10000))) invalid();
      push({type:'table',rows});
    } else if (header) {
      flush(); push({type:'heading',level:Math.min(header[1].length,3),text:header[2]});
    } else if (boldTitle || sectionTitle) {
      flush(); push({type:'heading',level:1,text:boldTitle?boldTitle[1]:trimmed});
    } else if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flush(); push({type:'rule'});
    } else {
      const bullet = line.match(/^\s*[-*+]\s+(.+)$/), numbered = line.match(/^\s*(\d{1,4})[.)]\s+(.+)$/);
      if (bullet || numbered) { flush(); push({type:'item',text:bullet ? bullet[1] : numbered[2],marker:bullet ? '•' : numbered[1]+'.'}); }
      else paragraph.push(line);
    }
  }
  flush(); return blocks;
}
const inlineHTML = text => inline(text).map(run => {
  const safe = esc(run.text).replace(/\n/g,'<br>');
  return run.bold ? '<strong>'+safe+'</strong>' : run.italics ? '<em>'+safe+'</em>' : safe;
}).join('');
function html(subject, blocks) {
  const content = blocks.map(b => {
    if (b.type === 'heading') return `<h${b.level+1} style="color:#173b75;margin:24px 0 10px;line-height:1.3">${inlineHTML(b.text)}</h${b.level+1}>`;
    if (b.type === 'rule') return '<hr style="border:0;border-top:1px solid #dce5f2;margin:24px 0">';
    if (b.type === 'table') return '<table role="table" cellpadding="8" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed;margin:16px 0">'+b.rows.map((row,i) => '<tr>'+row.map(cell => `<${i?'td':'th'} style="border:1px solid #dce5f2;text-align:left;vertical-align:top;overflow-wrap:anywhere;${i?'':'background:#edf3ff;'}">${inlineHTML(cell)}</${i?'td':'th'}>`).join('')+'</tr>').join('')+'</table>';
    if (b.type === 'item') return '<p style="margin:6px 0 6px 16px">'+esc(b.marker)+' '+inlineHTML(b.text)+'</p>';
    return '<p style="margin:0 0 14px">'+inlineHTML(b.text)+'</p>';
  }).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f7fc;color:#17243b;font-family:Arial,sans-serif;line-height:1.6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;margin:auto;background:white;border:1px solid #dce5f2"><tr><td style="padding:24px;background:#173b75;color:white"><strong>TenderCrest AI</strong><h1 style="font-size:24px;line-height:1.3;margin:12px 0">'+esc(subject)+'</h1><p style="margin:0">Draft for human review · editable Word document attached</p></td></tr><tr><td style="padding:24px;overflow-wrap:anywhere">'+content+'</td></tr><tr><td style="padding:20px 24px;background:#edf3ff;font-size:13px">Verify evidence, facts, pricing and buyer instructions before submission. This email does not indicate reviewer approval or submission to the buyer.</td></tr></table></td></tr></table></body></html>';
}
const runs = text => inline(text).flatMap(run => run.text.split('\n').map((part,i) => new D.TextRun({...run,text:part,break:i?1:undefined})));
async function word(subject,blocks) {
  const children = [new D.Paragraph({text:subject,heading:D.HeadingLevel.TITLE}),new D.Paragraph({text:'DRAFT FOR HUMAN REVIEW',style:'Subtitle'}),new D.Paragraph({text:'Verify evidence, facts, pricing and buyer instructions before submission. This document is not a reviewer approval.'})];
  for (const b of blocks) {
    if (b.type === 'rule') { children.push(new D.Paragraph({text:'—'})); continue; }
    if (b.type === 'table') {
      children.push(new D.Table({width:{size:100,type:D.WidthType.PERCENTAGE},rows:b.rows.map((row,i) => new D.TableRow({tableHeader:i===0,children:row.map(cell => new D.TableCell({shading:i===0?{fill:'EDF3FF'}:undefined,children:[new D.Paragraph({children:runs(cell)})]}))}))}));
    } else children.push(new D.Paragraph({heading:b.type==='heading'?[D.HeadingLevel.HEADING_1,D.HeadingLevel.HEADING_2,D.HeadingLevel.HEADING_3][b.level-1]:undefined,children:runs((b.type==='item'?b.marker+' ':'')+b.text)}));
  }
  const document = new D.Document({creator:'TenderCrest AI',title:subject,description:'Proposal draft for human review',styles:{default:{document:{run:{font:'Calibri',size:22},paragraph:{spacing:{after:160,line:276}}}}},sections:[{properties:{page:{margin:{top:1080,bottom:1080,left:1080,right:1080}}},headers:{default:new D.Header({children:[new D.Paragraph({text:'TenderCrest AI · Proposal draft'})]})},footers:{default:new D.Footer({children:[new D.Paragraph({alignment:D.AlignmentType.CENTER,children:[new D.TextRun('Draft for review · Page '),new D.TextRun({children:[D.PageNumber.CURRENT]}),new D.TextRun(' of '),new D.TextRun({children:[D.PageNumber.TOTAL_PAGES]})]})]})},children}]});
  return D.Packer.toBuffer(document);
}
async function presentation(subject,message) {
  subject=normalizeBrand(subject);message=normalizeBrand(message);
  const blocks = parse(message),bytes = await word(subject,blocks);
  if (bytes.length > 2097152) invalid();
  const filename = (subject.normalize('NFKD').replace(/[^a-zA-Z0-9 _-]/g,'').trim().replace(/\s+/g,'-').slice(0,90)||'proposal')+'-draft.docx';
  return {subject,text:message,html:html(subject,blocks),attachment:{filename,content:bytes.toString('base64'),content_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}};
}
module.exports = {parse,html,word,presentation,normalizeBrand,validXMLText};
