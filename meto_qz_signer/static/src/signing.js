/** @odoo-module **/
import { patch } from "@web/core/utils/patch";
import { MetoEditor } from "@meto_label_editor/action";
patch(MetoEditor.prototype, {
    setup() {
        super.setup(...arguments);
        const original = this.onMessage;
        let active = 0;
        this.onMessage = async (event) => {
            if (event.origin !== this.origin || event.source !== this.frame.el?.contentWindow || event.data?.channel !== this.channel) return;
            if (event.data.type === "meto:qz:status") {
                this.orm.call("meto.qz.signer", "certificate", []).then(() => {
                    if (event.source === this.frame.el?.contentWindow) event.source.postMessage({type:"meto:qz:available",channel:this.channel},this.origin);
                }).catch(() => {});
                return;
            }
            if (event.data.type !== "meto:qz:request") return original(event);
            const { id, operation, message } = event.data;
            if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) return;
            active++;
            const reply = { type: "meto:qz:response", channel: this.channel, id };
            try {
                if (active > 4) throw new Error("Troppe richieste");
                if (operation === "certificate") reply.value = await this.orm.call("meto.qz.signer", "certificate", []);
                else if (operation === "sign" && typeof message === "string" && message.length <= 2000000) reply.value = await this.orm.call("meto.qz.signer", "sign_message", [message]);
                else throw new Error("Operazione non consentita");
            } catch (_) { reply.error = "Firma METO non disponibile: verificare modulo, autorizzazioni e chiave sul server"; }
            finally { active--; }
            if (event.source === this.frame.el?.contentWindow) event.source.postMessage(reply, this.origin);
        };
    },
    onFrameLoad() {
        super.onFrameLoad(...arguments);
        this.orm.call("meto.qz.signer", "certificate", []).then(() => {
            this.frame.el?.contentWindow?.postMessage({type:"meto:qz:available",channel:this.channel}, this.origin);
        }).catch(() => {});
    },
});
