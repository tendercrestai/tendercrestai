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
    body:JSON.stringify({action:"handoff",analysisId:id})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Analysis could not be loaded.");
  if (typeof result.sourceText !== "string" || !result.sourceText.trim() || result.sourceText.length > 100000 ||
      !/^[0-9a-f]{64}$/.test(result.reviewHash || "") || !result.packet ||
      !["Completed","Partial"].includes(result.packet.analysisStatus) ||
      !Array.isArray(result.packet.requirements) || !result.packet.requirements.length ||
      !Array.isArray(result.packet.warnings) || result.packet.warnings.some(w=>typeof w!=="string"))
    throw new Error("Invalid compliance handoff response. Reload the analysis before continuing.");
  // A delayed response must not restore private text after signout or account switching.
  const verified = await supabase.auth.getUser();
  const current = await supabase.auth.getSession();
  if (verified.error || current.error || !data.session.user?.id ||
      verified.data.user?.id !== data.session.user.id ||
      current.data.session?.user.id !== data.session.user.id)
    throw new Error("Account changed. Sign in again before loading this analysis.");
  const input = document.getElementById("rfp-content");
  input.value = result.sourceText;
  input.dispatchEvent(new Event("input",{bubbles:true}));
  window.tendercrestComplianceContext = {complianceAnalysisId:id,complianceReviewHash:result.reviewHash};
  input.addEventListener("input", () => {
    if (input.value.trim() === result.sourceText) return;
    window.tendercrestComplianceContext = undefined;
    const notice = document.getElementById("compliance-context-notice");
    if (notice) notice.textContent = "RFP text changed: the compliance matrix is detached. Reopen it to link the reviewed requirements again.";
  });
  let notice = document.getElementById("compliance-context-notice");
  if (!notice) {
    notice = document.createElement("p"); notice.id = "compliance-context-notice"; notice.setAttribute("role","status");
    input.after(notice);
  }
  notice.textContent = result.packet.requirements.length + " reviewed requirements linked. Analysis: " + result.packet.analysisStatus +
    ". " + result.packet.warnings.join(" ") + " Reviewer status labels do not verify company capabilities.";
  return "RFP text, reviewed requirements and evidence gaps linked. Review the matrix and provide current qualifications. Submission creates a proposal and uses your existing allowance.";
}
