/** @odoo-module **/
import { Component, onWillStart, onMounted, onWillUnmount, useRef, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

export class MetoEditor extends Component {
    static template = "meto_label_editor.Editor";
    static props = ["*"];
    setup() {
        this.orm = useService("orm");
        this.frame = useRef("editor");
        this.state = useState({ url: "", error: "", loaded: false });
        this.channel = crypto.randomUUID();
        this.origin = "";
        this.product = null;
        this.sent = false;
        this.activationCode = null;
        this.activationSent = false;
        this.timeout = null;
        this.onMessage = (event) => {
            if (event.origin !== this.origin || event.source !== this.frame.el?.contentWindow || event.data?.channel !== this.channel) return;
            if (["meto:ready", "meto:activation-ready"].includes(event.data.type) && this.activationCode && !this.activationSent) {
                this.activationSent = true;
                event.source.postMessage({type:"meto:activate",channel:this.channel,code:this.activationCode},this.origin);
                this.activationCode = null;
            }
            if (event.data.type === "meto:ready") {
                this.state.loaded = true;
                this.state.error = "";
                clearTimeout(this.timeout);
                if (this.product && !this.sent) {
                    this.sent = true;
                    event.source.postMessage({ type: "meto:product", channel: this.channel, product: this.product }, this.origin);
                }
            }
        };
        onWillStart(async () => {
            try {
                const url = new URL("https://meto-label-editor.ecommerce-d86.workers.dev/");
                if (url.protocol !== "https:") throw new Error("L’editor METO richiede HTTPS");
                this.origin = url.origin;
                url.searchParams.set("channel", this.channel);
                this.state.url = url.href;
                // ACL: only internal users may read the enrollment configuration.
                // No enrollment value is present in source assets or URL parameters.
                try {
                    const settings = await this.orm.searchRead("x_meto_qz_configuration", [], ["x_activation_code"], {limit:1});
                    this.activationCode = settings[0]?.x_activation_code || null;
                } catch (_) { /* An unconfigured installation keeps manual activation. */ }
                const p = this.props.action.params || {};
                if (["product.template", "product.product"].includes(p.model) && Number.isSafeInteger(p.record_id) && p.record_id > 0) {
                    const records = await this.orm.read(p.model, [p.record_id], ["name", "default_code", "barcode"]);
                    this.product = records[0] || null;
                }
            } catch (error) { this.state.url = ""; this.state.error = error.message || "Impossibile aprire METO"; }
        });
        onMounted(() => {
            window.addEventListener("message", this.onMessage);
            this.timeout = setTimeout(() => {
                if (this.state.url && !this.state.loaded) this.state.error = "METO non conferma il collegamento: verificare il dominio Odoo autorizzato su Cloudflare e la rete.";
            }, 15000);
        });
        onWillUnmount(() => { window.removeEventListener("message", this.onMessage); clearTimeout(this.timeout); });
    }
    onFrameLoad() {
        this.frame.el?.contentWindow?.postMessage({ type: "meto:hello", channel: this.channel }, this.origin);
    }
}
registry.category("actions").add("meto_label_editor.editor", MetoEditor);
