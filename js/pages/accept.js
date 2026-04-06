import * as api from "../api.js";
import { render, spinner, alert as alertHtml, escHtml } from "../ui.js";

export async function mountAccept(el, token) {
  render(el, `
    <div style="display:flex;align-items:center;justify-content:center;min-height:60vh">
      <div class="login-box">
        <div class="login-logo">Wren Admin</div>
        <div id="accept-content">${spinner()}</div>
      </div>
    </div>`);

  const content = el.querySelector("#accept-content");

  if (!token) {
    content.innerHTML = alertHtml("Invalid invite link — no token found.");
    return;
  }

  try {
    const result = await api.acceptInviteToken(token);
    content.innerHTML = `
      <div class="alert alert-success">
        Invite accepted! You have joined <strong>${escHtml(result.orgName ?? result.org ?? "the organisation")}</strong>.
      </div>
      <a class="btn btn-primary" href="#/" style="display:block;text-align:center;margin-top:1rem">Go to dashboard</a>`;
  } catch (err) {
    if (err.status === 401) {
      content.innerHTML = `
        <div class="alert alert-error" style="margin-bottom:1rem">
          You need to be signed in to accept this invite.
        </div>
        <p class="muted" style="font-size:13px;margin:0 0 .75rem">After signing in, visit this link again.</p>
        <a class="btn btn-primary" href="#/" style="display:block;text-align:center">Sign in</a>`;
    } else {
      content.innerHTML = `
        ${alertHtml(err.message)}
        <a class="btn btn-sm" href="#/" style="display:block;text-align:center;margin-top:1rem">Back to app</a>`;
    }
  }
}
