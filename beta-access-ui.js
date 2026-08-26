(function (root) {
  "use strict";
  const $ = id => document.getElementById(id);
  const serviceApi = root.PolynBetaAccess;
  if (!serviceApi) return;

  // Two surfaces over one table:
  //
  //   Help banner  - the operator's own row, read through the anonymous RT
  //                  Sync identity. Three states: request / pending /
  //                  invited, exactly one visible.
  //   Beta Applicants panel - every row, read through the separate admin
  //                  client, with the checkbox that flips pending to
  //                  invited.

  const service = serviceApi.create({
    getTransport: () => root.PolynBetaAccessBridge?.getTransport?.() || null,
    getAdminClient: () => root.PolynResinAdminInstance?.getClient?.() || null
  });

  let application = null;
  let applicants = [];
  let listInFlight = false;
  let statusInFlight = false;

  function fmtDate(value){ return value ? new Date(value).toLocaleDateString() : "—"; }

  function setMessage(id, text, type = ""){
    const el = $(id);
    if (!el) return;
    el.textContent = text || "";
    el.className = `tiny${type ? ` ${type}` : ""}`;
  }

  /* --------------------------------------------------------------------
   *   Help banner
   * ------------------------------------------------------------------ */

  function bannerState(){
    if (application?.status === serviceApi.STATUS_INVITED) return "invited";
    if (application?.status === serviceApi.STATUS_PENDING) return "pending";
    return "none";
  }

  function renderBanner(){
    const host = $("helpBetaAccess");
    if (!host) return;
    host.dataset.betaState = bannerState();
    const note = $("helpBetaPendingNote");
    if (note && application?.email){
      note.textContent = `Requested as ${application.email}. The download link appears here once you're added to the tester list.`;
    }
  }

  // First paint uses the last answer the server gave this browser, so an
  // approved operator is not shown a request button for the second it takes
  // RT Sync to come up. Reconciled immediately afterwards.
  function primeFromCache(){
    const entry = service.cached();
    if (entry) application = { status: entry.status, email: entry.email, displayName: entry.displayName };
    renderBanner();
  }

  async function refreshStatus(){
    if (statusInFlight) return;
    statusInFlight = true;
    try{
      const result = await service.getMyApplication();
      // A failed read leaves the cached answer alone on purpose: a dropped
      // connection must never demote an approved operator back to a request
      // button.
      if (result.ok) application = result.application;
      renderBanner();
    }finally{
      statusInFlight = false;
    }
  }

  function openRequestDialog(){
    const dialog = $("betaRequestDialog");
    if (!dialog) return;
    const name = $("betaRequestName");
    const email = $("betaRequestEmail");
    if (name) name.value = application?.displayName || "";
    if (email) email.value = application?.email || "";
    const withdraw = $("betaRequestWithdraw");
    if (withdraw) withdraw.hidden = !application;
    setMessage("betaRequestMessage", "");
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(()=>name?.focus());
  }

  function closeRequestDialog(){
    const dialog = $("betaRequestDialog");
    if (dialog?.open) dialog.close();
  }

  async function submitRequest(event){
    event.preventDefault();
    const submitBtn = $("betaRequestSubmit");
    const name = $("betaRequestName")?.value || "";
    const email = $("betaRequestEmail")?.value || "";
    if (submitBtn) submitBtn.disabled = true;
    setMessage("betaRequestMessage", "Sending…");
    const result = await service.submit(email, name);
    if (submitBtn) submitBtn.disabled = false;
    if (!result.ok){
      setMessage("betaRequestMessage", result.message, "warn");
      return;
    }
    application = {
      status: result.status,
      email: serviceApi.normalizeEmail(email),
      displayName: serviceApi.normalizeName(name)
    };
    renderBanner();
    closeRequestDialog();
    void refreshStatus();
  }

  async function withdrawRequest(){
    if (!confirm("Withdraw your beta access request? Your name and email are deleted.")) return;
    setMessage("betaRequestMessage", "Withdrawing…");
    const result = await service.withdraw();
    if (!result.ok){
      setMessage("betaRequestMessage", result.message, "warn");
      return;
    }
    application = null;
    renderBanner();
    closeRequestDialog();
  }

  /* --------------------------------------------------------------------
   *   Beta Applicants (admin)
   * ------------------------------------------------------------------ */

  function renderApplicants(){
    const host = $("betaApplicantsList");
    if (!host) return;
    host.innerHTML = "";
    if (!applicants.length){
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No one has requested beta access yet.";
      host.append(empty);
      return;
    }
    applicants.forEach(applicant=>{
      const row = document.createElement("div");
      row.className = "betaApplicantRow";
      row.dataset.status = applicant.status;

      const check = document.createElement("label");
      check.className = "betaApplicantCheck";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = applicant.status === serviceApi.STATUS_INVITED;
      box.setAttribute("aria-label", `Added ${applicant.email} to internal testing on Google Play`);
      // "Added", not "Invited": the box records the thing the administrator
      // actually did in Play Console. The pill beside it carries the state
      // that results, so the two are not saying the same word twice.
      const boxText = document.createElement("span");
      boxText.textContent = "Added";
      check.append(box, boxText);

      const info = document.createElement("div");
      info.className = "betaApplicantInfo";
      const who = document.createElement("strong");
      who.textContent = applicant.displayName;
      const mail = document.createElement("span");
      mail.className = "mono betaApplicantEmail";
      mail.textContent = applicant.email;
      const meta = document.createElement("small");
      meta.textContent = applicant.status === serviceApi.STATUS_INVITED
        ? `Invited ${fmtDate(applicant.invitedAt)}`
        : `Requested ${fmtDate(applicant.createdAt)}`;
      info.append(who, mail, meta);

      const status = document.createElement("span");
      status.className = `pill betaApplicantStatus ${applicant.status}`;
      status.textContent = applicant.status === serviceApi.STATUS_INVITED ? "Invited" : "Pending";

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "betaApplicantRemove";
      remove.textContent = "×";
      remove.title = `Remove ${applicant.email}`;
      remove.setAttribute("aria-label", `Remove ${applicant.email}`);

      box.addEventListener("change", async ()=>{
        box.disabled = true;
        const result = await service.setInvited(applicant.id, box.checked);
        box.disabled = false;
        if (!result.ok){
          box.checked = applicant.status === serviceApi.STATUS_INVITED;
          setMessage("betaApplicantsMessage", result.message, "warn");
          return;
        }
        setMessage(
          "betaApplicantsMessage",
          box.checked
            ? `${applicant.email} can now see the download link.`
            : `${applicant.email} is back to pending.`,
          "ok"
        );
        void loadApplicants();
      });

      remove.addEventListener("click", async ()=>{
        if (!confirm(`Remove ${applicant.email} from the applicant list?`)) return;
        const result = await service.removeApplicant(applicant.id);
        if (!result.ok){
          setMessage("betaApplicantsMessage", result.message, "warn");
          return;
        }
        setMessage("betaApplicantsMessage", `Removed ${applicant.email}.`, "ok");
        void loadApplicants();
      });

      row.append(check, info, status, remove);
      host.append(row);
    });
  }

  async function loadApplicants(){
    if (listInFlight) return;
    listInFlight = true;
    setMessage("betaApplicantsMessage", "Loading…");
    const result = await service.listApplicants();
    listInFlight = false;
    if (!result.ok){
      setMessage("betaApplicantsMessage", result.message, "warn");
      return;
    }
    applicants = result.applicants;
    const pending = applicants.filter(a=>a.status === serviceApi.STATUS_PENDING).length;
    setMessage(
      "betaApplicantsMessage",
      pending ? `${pending} waiting for an invitation.` : "Nobody is waiting.",
      pending ? "warn" : ""
    );
    renderApplicants();
  }

  /* --------------------------------------------------------------------
   *   Wiring
   * ------------------------------------------------------------------ */

  function hook(){
    primeFromCache();

    $("helpBetaRequestBtn")?.addEventListener("click", openRequestDialog);
    $("helpBetaEditBtn")?.addEventListener("click", openRequestDialog);
    $("betaRequestForm")?.addEventListener("submit", submitRequest);
    $("betaRequestWithdraw")?.addEventListener("click", withdrawRequest);
    document.querySelectorAll("#betaRequestDialog [data-beta-close]").forEach(button=>{
      button.addEventListener("click", closeRequestDialog);
    });

    // RT Sync signs in asynchronously, so the first read usually has no
    // transport yet. Re-read whenever "Workspace & support" is opened - the
    // banner lives in that foldaway extras list (in Help's old nav slot),
    // so that toggle is the only moment it's actually on screen.
    $("workspaceNavMore")?.addEventListener("click", ()=>{ void refreshStatus(); });

    $("betaApplicantsRefreshBtn")?.addEventListener("click", ()=>{ void loadApplicants(); });
    $("betaApplicantsButton")?.addEventListener("click", ()=>{ void loadApplicants(); });

    // One catch-up pass once the anonymous session has had a chance to come
    // up, so a Help panel already open at load settles on the right state.
    setTimeout(()=>{ void refreshStatus(); }, 2500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hook);
  else hook();

  root.PolynBetaAccessUI = { refreshStatus, loadApplicants };
})(typeof globalThis !== "undefined" ? globalThis : this);
