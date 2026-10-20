/* Never install trust roots or claim trust from browser state. */
(function () {
  const dialog = document.getElementById("certificateDialog");
  document.getElementById("certificateSetup").addEventListener("click", () => dialog.showModal());
  document.getElementById("closeCertificateDialog").addEventListener("click", () => dialog.close());
})();
