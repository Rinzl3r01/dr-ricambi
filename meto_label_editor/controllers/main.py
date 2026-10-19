from urllib.parse import urlsplit
from odoo import http
from odoo.exceptions import UserError
from odoo.http import request
from werkzeug.exceptions import Forbidden

class MetoCloudflare(http.Controller):
    @http.route('/meto/config', type='jsonrpc', auth='user', methods=['POST'])
    def config(self):
        if not request.env.user.has_group('base.group_user'):
            raise Forbidden()
        # Only this non-secret deployment setting is read with elevated privileges.
        url = request.env['ir.config_parameter'].sudo().get_param('meto_label_editor.editor_url', '').strip()
        parsed = urlsplit(url)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path not in ('', '/')):
            raise UserError('METO: configurare il parametro meto_label_editor.editor_url con l’origine HTTPS dell’editor Cloudflare, senza percorsi.')
        return {'editor_url': url.rstrip('/') + '/'}
