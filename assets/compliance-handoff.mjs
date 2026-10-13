export function proposalText(analysis) {
  const text = analysis.documents.map(d => d.segments.map(s => s.text).join("\n\n")).join("\n\n");
  if (!text || text.length > 100000) throw new Error("Combined source text exceeds the proposal workflow limit. Select the relevant text manually.");
  return text;
}
export async function loadComplianceHandoff(supabase, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new Error("Invalid compliance analysis.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Log in to load this compliance analysis.");
  const response = await fetch("/.netlify/functions/compliance", {
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+data.session.access_token},
    body:JSON.stringify({action:"get",analysisId:id})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Analysis could not be loaded.");
  document.getElementById("rfp-content").value = proposalText(result.analysis);
  document.getElementById("proposal-name").value = (result.analysis.facts.find(f=>f.type==="Title")?.value || result.analysis.documents[0].name).slice(0,300);
  document.getElementById("proposal-qualifications").value = "";
  document.getElementById("rfp-content").dispatchEvent(new Event("input",{bubbles:true}));
  return "RFP source text loaded from compliance preview (" + result.analysis.status + "). Review it and supply verified qualifications. Submitting here creates a proposal and uses the existing allowance.";
}
