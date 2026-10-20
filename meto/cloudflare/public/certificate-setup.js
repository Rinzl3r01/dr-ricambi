/* Never install trust roots or claim trust from browser state. */
(function () {
  const dialog = document.getElementById("certificateDialog");
  document.getElementById("certificateSetup").addEventListener("click", () => dialog.showModal());
  document.getElementById("closeCertificateDialog").addEventListener("click", () => dialog.close());
  document.getElementById("activateCertificate").addEventListener("click", async () => {
    const button=document.getElementById("activateCertificate"), field=document.getElementById("certificateCode"), status=document.getElementById("certificateActivationStatus");
    button.disabled=true;
    try {
      await window.metoCloudSigning.activate(field.value.trim());field.value="";
      status.textContent="Browser attivato. Configura il certificato in QZ, poi ricarica METO prima di collegare QZ Tray.";
    } catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
  });
})();
