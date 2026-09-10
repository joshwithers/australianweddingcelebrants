/**
 * AWC Listings Worker v3
 *
 * Magic-link auth, AI content cleanup, GitHub push, delayed notifications,
 * full admin dashboard, AI bio editing, bulk email.
 *
 * KV key structure:
 *   session:{token}      → { email, role, slug?, created }     TTL: 24h
 *   magic:{token}        → { email, type, slug?, created }     TTL: 15min
 *   submission:{id}      → full submission object               TTL: 90d
 *   email:{email}        → slug                                 persistent
 *   notify:{id}          → { submission_id, approved_at, slug } TTL: 1h
 *   ai_usage:{email}     → { total_cost, call_count }          TTL: 90d
 *   image:{id}           → image data                           TTL: 90d
 *   logo:{id}            → logo data                            TTL: 90d
 *   evidence:{id}        → evidence files                       TTL: 90d
 *   cache:listings       → GitHub directory listing cache       TTL: 5min
 *   email_blast:{ts}     → send record                          TTL: 90d
 */

import { handleMcp } from "./mcp.js";
import { handleA2A, handleA2AReport, sendWeeklyEnquiryDigest } from "./a2a.js";

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // MCP endpoint has its own CORS (open) and handles OPTIONS itself.
    if (path === "/mcp") return handleMcp(request, env);

    // A2A endpoint + public report-spam link.
    if (path === "/a2a") return handleA2A(request, env);
    if (path === "/a2a/report" && request.method === "GET") return handleA2AReport(request, env);

    // OpenAI Apps SDK domain-verification challenge. GET or HEAD; verifier
    // may use either.
    if (path === "/.well-known/openai-apps-challenge" && (request.method === "GET" || request.method === "HEAD")) {
      return new Response(
        request.method === "HEAD" ? null : "ePLo21rwQXxowhQdsMPMki9ilN6i6PkWDOXTgss3DC0",
        {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        },
      );
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    try {
      // Public auth routes
      if (path === "/login" && request.method === "GET") return loginPage(url, env);
      if (path === "/login" && request.method === "POST") return handleLogin(request, env);
      if (path === "/auth") return handleAuth(url, env);

      // Celebrant routes (session required — admin also allowed)
      if (path === "/form") return withSession(request, env, handleForm);
      if (path === "/submit" && request.method === "POST") return withSession(request, env, (req, e, s) => handleSubmit(req, e, s, ctx));
      if (path === "/ai-edit" && request.method === "POST") return withSession(request, env, handleAiEdit);

      // Public — award nominations (no auth, honeypot + rate limit only)
      // Step 1: draft returns AI-generated title suggestions + justification.
      // Step 2: send emails the admin once the nominator has confirmed.
      if (path === "/award-nomination" && request.method === "POST") return handleAwardNominationDraft(request, env, ctx);
      if (path === "/award-nomination/send" && request.method === "POST") return handleAwardNominationSend(request, env, ctx);

      // Image proxy (serves repo assets through authenticated GitHub API)
      if (path === "/asset" && request.method === "GET") return withAnySession(request, env, handleAssetProxy);

      // Admin routes
      if (path === "/admin/auth") return handleAdminAuth(url, env);
      if (path === "/admin" && request.method === "GET") return withAdminSession(request, env, handleAdminDashboard);
      if (path === "/admin/review") return withAdminSession(request, env, handleAdminReview);
      if (path === "/admin/approve" && request.method === "POST") return withAdminSession(request, env, handleAdminApprove);
      if (path === "/admin/reject" && request.method === "POST") return withAdminSession(request, env, handleAdminReject);
      if (path === "/admin/listings") return withAdminSession(request, env, handleAdminListings);
      if (path === "/admin/submissions") return withAdminSession(request, env, handleAdminSubmissions);
      if (path === "/admin/edit" && request.method === "GET") return withAdminSession(request, env, handleAdminEdit);
      if (path === "/admin/edit" && request.method === "POST") return withAdminSession(request, env, (req, e, s) => handleAdminEditSave(req, e, s, ctx));
      if (path === "/admin/image" && request.method === "GET") return withAdminSession(request, env, handleAdminImage);
      if (path === "/admin/email" && request.method === "GET") return withAdminSession(request, env, handleAdminEmail);
      if (path === "/admin/email" && request.method === "POST") return withAdminSession(request, env, (req, e, s) => handleAdminEmailSend(req, e, s, ctx));
      if (path === "/admin/ai-cleanup" && request.method === "POST") return withAdminSession(request, env, handleAdminAiCleanup);

      // Catch-all
      return htmlResponse(pageShell("Not Found", `<h1>Page not found</h1><p>Nothing here.</p><a href="${env.SITE_URL}" class="btn btn-dark">Back to site</a>`), 404);

    } catch (err) {
      console.error("Unhandled error:", err);
      return htmlResponse(pageShell("Error", `<h1>Something went wrong</h1><p>An unexpected error occurred. Please try again or contact us if the problem persists.</p>`), 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(processDelayedNotifications(env));
    // Weekly A2A enquiry digest: Monday 09:00 UTC (cron runs every 5 minutes
    // so we de-bounce ourselves via a lightweight KV guard).
    const now = new Date();
    if (now.getUTCDay() === 1 && now.getUTCHours() === 9 && now.getUTCMinutes() < 5) {
      const guardKey = `a2a:digest_sent:${now.toISOString().slice(0, 10)}`;
      ctx.waitUntil((async () => {
        const already = await env.KV.get(guardKey);
        if (already) return;
        await env.KV.put(guardKey, "1", { expirationTtl: 7 * 24 * 60 * 60 });
        try {
          await sendWeeklyEnquiryDigest(env);
        } catch (e) {
          console.error("Weekly A2A digest failed:", e);
        }
      })());
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Auth — Magic Links & Sessions
// ─────────────────────────────────────────────────────────────────────────────

function loginPage(url, env) {
  const slug = url.searchParams.get("slug") || "";
  const mode = slug ? "edit" : "new";
  const error = url.searchParams.get("error") || "";

  const errorHtml = error ? `<div class="alert alert-error">${esc(error)}</div>` : "";

  const body = `
    <h1>${mode === "edit" ? "Edit Your Listing" : "Join the Directory"}</h1>
    <p>${mode === "edit"
      ? "Enter the email address on file for your listing and we'll send you a magic link to edit it."
      : "Enter your email address to create your free listing. We'll send you a magic link to get started."
    }</p>
    ${errorHtml}
    <form method="POST" action="/login" class="space-y-4 mt-6">
      <input type="hidden" name="slug" value="${esc(slug)}" />
      <input type="hidden" name="mode" value="${mode}" />
      <div>
        <label for="email" class="label">Email address</label>
        <input type="email" id="email" name="email" required class="input" placeholder="hello@example.com" />
      </div>
      <button type="submit" class="btn btn-primary w-full">Send Magic Link</button>
    </form>
    <p class="hint mt-6">No password needed — we'll email you a secure login link.</p>
  `;

  return htmlResponse(pageShell(mode === "edit" ? "Edit Listing" : "Join Directory", body));
}

async function handleLogin(request, env) {
  const form = await request.formData();
  const email = (form.get("email") || "").trim().toLowerCase();
  const slug = (form.get("slug") || "").trim();
  const mode = form.get("mode") || "new";

  if (!email || !isValidEmail(email)) {
    return redirect(`/login?slug=${slug}&error=Please enter a valid email address`);
  }

  // Rate limit magic link requests: max 3 per email per 15 minutes
  const rateLimitKey = `ratelimit:login:${email}`;
  const attempts = parseInt(await env.KV.get(rateLimitKey) || "0", 10);
  if (attempts >= 3) {
    return redirect(`/login?slug=${slug}&error=Too many login attempts. Please wait 15 minutes and try again.`);
  }
  await env.KV.put(rateLimitKey, String(attempts + 1), { expirationTtl: 900 });

  if (mode === "edit" && slug) {
    // Editing existing listing — fetch from GitHub to verify email matches
    const file = await fetchFileFromGitHub(env, slug);
    if (!file) {
      return redirect(`/login?slug=${slug}&error=Listing not found`);
    }
    const frontmatter = parseFrontmatter(file.content);
    if (frontmatter.email?.toLowerCase() !== email) {
      return redirect(`/login?slug=${slug}&error=That email doesn't match the listing on file`);
    }
  } else if (mode === "new") {
    // Check if admin email — skip existing listing check
    const isAdmin = email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase();

    if (!isAdmin) {
      // New listing — check if email already exists (KV first, then search GitHub)
      let existingSlug = await env.KV.get(`email:${email}`);

      if (!existingSlug) {
        existingSlug = await findSlugByEmail(env, email);
        if (existingSlug) {
          await env.KV.put(`email:${email}`, existingSlug);
        }
      }

      if (existingSlug) {
        return redirect(`/login?slug=${encodeURIComponent(existingSlug)}&error=That email is already linked to a listing. We've switched you to the edit flow.`);
      }
    }
  }

  // Generate and store magic link
  const token = generateToken();
  await env.KV.put(`magic:${token}`, JSON.stringify({
    email, type: "celebrant", slug: slug || null, mode, created: Date.now(),
  }), { expirationTtl: 900 }); // 15 min

  // Send magic link email
  const authUrl = `${env.WORKER_URL}/auth?token=${token}`;
  await sendEmail(env, {
    to: email,
    subject: mode === "edit" ? "Edit your listing — Australian Wedding Celebrants" : "Create your listing — Australian Wedding Celebrants",
    html: magicLinkEmailHtml(authUrl, mode, env),
  });

  return htmlResponse(pageShell("Check Your Email", `
    <h1>Check your email</h1>
    <p>We've sent a magic link to <strong>${esc(email)}</strong>. Click the link in the email to ${mode === "edit" ? "edit your listing" : "create your listing"}.</p>
    <p class="hint">The link expires in 15 minutes. Check your spam folder if you don't see it.</p>
  `));
}

async function handleAuth(url, env) {
  const token = url.searchParams.get("token");
  if (!token) return redirect("/login?error=Missing token");

  const raw = await env.KV.get(`magic:${token}`);
  if (!raw) return redirect("/login?error=This link has expired. Please request a new one.");

  const magic = JSON.parse(raw);
  await env.KV.delete(`magic:${token}`); // one-time use

  // Check if this is the admin email
  const isAdmin = magic.email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase();

  // Create session
  const sessionToken = generateToken();
  await env.KV.put(`session:${sessionToken}`, JSON.stringify({
    email: magic.email, role: isAdmin ? "admin" : "celebrant", slug: magic.slug, mode: magic.mode, created: Date.now(),
  }), { expirationTtl: 86400 }); // 24h

  // Admin goes to dashboard, celebrant goes to form
  const redirectTo = isAdmin ? "/admin" : "/form";

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectTo,
      "Set-Cookie": `awc_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
    },
  });
}

async function handleAdminAuth(url, env) {
  const token = url.searchParams.get("token");
  const submissionId = url.searchParams.get("id");
  if (!token) return htmlResponse(pageShell("Error", "<h1>Missing token</h1>"), 400);

  const raw = await env.KV.get(`magic:${token}`);
  if (!raw) return htmlResponse(pageShell("Error", "<h1>Link expired</h1><p>Please request a new admin link from the notification email.</p>"), 400);

  const magic = JSON.parse(raw);
  if (magic.type !== "admin") return htmlResponse(pageShell("Error", "<h1>Invalid token</h1>"), 400);
  await env.KV.delete(`magic:${token}`);

  // Create admin session
  const sessionToken = generateToken();
  await env.KV.put(`session:${sessionToken}`, JSON.stringify({
    email: magic.email, role: "admin", created: Date.now(),
  }), { expirationTtl: 86400 });

  const redirectUrl = submissionId ? `/admin/review?id=${submissionId}` : "/admin/review";

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl,
      "Set-Cookie": `awc_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Session middleware
// ─────────────────────────────────────────────────────────────────────────────

async function getSession(request, env) {
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(/awc_session=([a-f0-9]+)/);
  if (!match) return null;
  const raw = await env.KV.get(`session:${match[1]}`);
  return raw ? JSON.parse(raw) : null;
}

async function withSession(request, env, handler) {
  const session = await getSession(request, env);
  if (!session || (session.role !== "celebrant" && session.role !== "admin")) {
    return redirect("/login?error=Please log in first");
  }
  return handler(request, env, session);
}

async function withAnySession(request, env, handler) {
  const session = await getSession(request, env);
  if (!session) return new Response("Unauthorised", { status: 401 });
  return handler(request, env, session);
}

async function withAdminSession(request, env, handler) {
  const session = await getSession(request, env);
  if (!session || session.role !== "admin") {
    return htmlResponse(pageShell("Unauthorised", "<h1>Admin access required</h1><p>Use the link from your notification email to log in, or log in with the admin email address.</p>"), 403);
  }
  return handler(request, env, session);
}

// ─────────────────────────────────────────────────────────────────────────────
// Celebrant — Form & Submit
// ─────────────────────────────────────────────────────────────────────────────

async function handleForm(request, env, session) {
  let existing = null;

  if (session.slug) {
    // Fetch current listing from GitHub
    const file = await fetchFileFromGitHub(env, session.slug);
    if (file) {
      existing = parseFrontmatter(file.content);
      existing._body = parseBody(file.content);
    }
  }

  return htmlResponse(pageShell(
    existing ? "Edit Your Listing" : "Create Your Listing",
    formHtml(session, existing, env)
  ));
}

async function handleSubmit(request, env, session, ctx) {
  // Prevent duplicate submissions within a short window
  const dedupeKey = `submit-lock:${session.email}`;
  const existing_lock = await env.KV.get(dedupeKey);
  if (existing_lock) {
    return htmlResponse(pageShell("Submission Received", `
      <h1>Already submitted!</h1>
      <p>Your listing was already submitted a moment ago and is being processed. No need to submit again.</p>
      <a href="${env.SITE_URL}" class="btn btn-dark mt-6">Back to site</a>
    `));
  }
  await env.KV.put(dedupeKey, "1", { expirationTtl: 60 });

  const form = await request.formData();

  const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB
  const MAX_EVIDENCE_SIZE = 20 * 1024 * 1024; // 20 MB per file
  const MAX_EVIDENCE_FILES = 10;

  // Handle file uploads — store as base64 in KV
  const imageFile = form.get("image_file");
  const logoFile = form.get("logo_file");

  if (imageFile && imageFile.size > MAX_IMAGE_SIZE) {
    return htmlResponse(pageShell("Error", `<h1>File too large</h1><p>Profile photo must be under 20 MB.</p><a href="/form" class="btn btn-dark mt-4">Back to form</a>`), 400);
  }
  if (logoFile && logoFile.size > MAX_IMAGE_SIZE) {
    return htmlResponse(pageShell("Error", `<h1>File too large</h1><p>Logo must be under 20 MB.</p><a href="/form" class="btn btn-dark mt-4">Back to form</a>`), 400);
  }
  let imageData = null;
  let logoData = null;

  if (imageFile && imageFile.size > 0) {
    if (isSvg(imageFile)) {
      const buffer = await imageFile.arrayBuffer();
      imageData = { base64: arrayBufferToBase64(buffer), ext: "svg", name: imageFile.name, type: "image/svg+xml" };
    } else {
      const optimised = await optimiseImage(imageFile, { maxWidth: 1200, quality: 82 });
      imageData = { base64: optimised.base64, ext: "webp", name: imageFile.name, type: "image/webp" };
    }
  }

  if (logoFile && logoFile.size > 0) {
    if (isSvg(logoFile)) {
      const buffer = await logoFile.arrayBuffer();
      logoData = { base64: arrayBufferToBase64(buffer), ext: "svg", name: logoFile.name, type: "image/svg+xml" };
    } else {
      const optimised = await optimiseImage(logoFile, { maxWidth: 600, quality: 90 });
      logoData = { base64: optimised.base64, ext: "webp", name: logoFile.name, type: "image/webp" };
    }
  }

  const submission = {
    id: generateShortId(),
    title: (form.get("title") || "").trim(),
    brand_name: (form.get("brand_name") || "").trim(),
    description: (form.get("description") || "").trim(),
    bio: (form.get("bio") || "").trim(),
    email: session.email,
    website: (form.get("website") || "").trim(),
    phone: (form.get("phone") || "").trim(),
    address: (form.get("address") || "").trim(),
    image: imageData ? null : (form.get("existing_image") || "").trim() || null,
    logo: logoData ? null : (form.get("existing_logo") || "").trim() || null,
    has_image_upload: !!imageData,
    has_logo_upload: !!logoData,
    location: (form.get("location") || "").split(",").map(s => s.trim()).filter(Boolean),
    category: form.getAll("category").filter(Boolean),
    australia_wide: form.get("australia_wide") === "on",
    international: form.get("international") === "on",
    // Checkbox checked → explicit opt in. Unchecked or missing → not opted in.
    accepts_agent_enquiries: form.get("opt_enquiries_present") === "1"
      ? form.get("accepts_agent_enquiries") === "on"
      : false,
    year_started: parseYearStarted(form.get("year_started")),
    social: {
      facebook: (form.get("facebook") || "").trim(),
      instagram: (form.get("instagram") || "").trim(),
      pinterest: (form.get("pinterest") || "").trim(),
    },
    existing_slug: session.slug || null,
    existing_tier: null,
    existing_featured: false,
    // Tier upgrade evidence — fields mirror /tiers page requirements
    tier_upgrade: {
      cert_iv: (form.get("cert_iv") || "").trim(),
      registration_year: (form.get("registration_year") || "").trim(),
      insurance: (form.get("insurance") || "").trim(),
      professional_development: (form.get("professional_development") || "").trim(),
      ceremony_count: (form.get("ceremony_count") || "").trim(),
      couple_reviews_links: (form.get("couple_reviews_links") || "").trim(),
      vendor_reviews_links: (form.get("vendor_reviews_links") || "").trim(),
      sustainable_practice: (form.get("sustainable_practice") || "").trim(),
      industry_recognition: (form.get("industry_recognition") || "").trim(),
    },
    has_tier_evidence: false,
    submitted_at: new Date().toISOString(),
    status: "pending_ai",
  };

  // Check if any tier evidence was provided
  submission.has_tier_evidence = Object.values(submission.tier_upgrade).some(v => v && v.length > 0);

  // Handle evidence file uploads
  const evidenceFiles = form.getAll("evidence_files").filter(f => f && f.size > 0);
  if (evidenceFiles.length > MAX_EVIDENCE_FILES) {
    return htmlResponse(pageShell("Error", `<h1>Too many files</h1><p>Maximum ${MAX_EVIDENCE_FILES} evidence files allowed.</p><a href="/form" class="btn btn-dark mt-4">Back to form</a>`), 400);
  }
  const oversizedEvidence = evidenceFiles.find(f => f.size > MAX_EVIDENCE_SIZE);
  if (oversizedEvidence) {
    return htmlResponse(pageShell("Error", `<h1>File too large</h1><p>Each evidence file must be under 20 MB. "${esc(oversizedEvidence.name)}" is too large.</p><a href="/form" class="btn btn-dark mt-4">Back to form</a>`), 400);
  }
  const evidenceData = [];
  for (const file of evidenceFiles) {
    if (file && file.size > 0) {
      const buffer = await file.arrayBuffer();
      const ext = getFileExtension(file.name, file.type);
      evidenceData.push({ base64: arrayBufferToBase64(buffer), ext, name: file.name, type: file.type });
    }
  }
  if (evidenceData.length > 0) {
    submission.has_tier_evidence = true;
    submission.evidence_file_count = evidenceData.length;
    submission.evidence_files = evidenceData.map(f => ({ name: f.name, type: f.type, ext: f.ext }));
  }

  // If editing, carry over tier and featured from the existing listing
  if (session.slug) {
    const existingFile = await fetchFileFromGitHub(env, session.slug);
    if (existingFile) {
      const existingFm = parseFrontmatter(existingFile.content);
      submission.existing_tier = existingFm.tier || "registered";
      submission.existing_featured = existingFm.featured === true || existingFm.featured === "true";
    }
  }

  // Validate
  const errors = [];
  if (!submission.title) errors.push("Celebrant name is required");
  if (!submission.location.length) errors.push("At least one location is required");
  if (!submission.category.length) errors.push("At least one service category is required");
  if (errors.length) {
    return htmlResponse(pageShell("Error", `
      <h1>Please fix these issues</h1>
      <ul>${errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul>
      <a href="/form" class="btn btn-dark mt-4">Back to form</a>
    `), 400);
  }

  // Store raw submission
  await env.KV.put(`submission:${submission.id}`, JSON.stringify(submission), { expirationTtl: 90 * 86400 });

  // Store image files separately (KV values can be up to 25MB each)
  if (imageData) {
    await env.KV.put(`image:${submission.id}`, JSON.stringify(imageData), { expirationTtl: 90 * 86400 });
  }
  if (logoData) {
    await env.KV.put(`logo:${submission.id}`, JSON.stringify(logoData), { expirationTtl: 90 * 86400 });
  }
  if (evidenceData.length > 0) {
    await env.KV.put(`evidence:${submission.id}`, JSON.stringify(evidenceData), { expirationTtl: 90 * 86400 });
  }

  // AI cleanup + admin notification — runs in background via waitUntil
  const backgroundWork = (async () => {
    // Step 1: Try AI cleanup
    let aiStatus = "skipped";
    try {
      const cleaned = await cleanupWithAI(env, submission);
      submission.title = cleaned.title || submission.title;
      submission.meta_title = cleaned.meta_title || "";
      submission.description = cleaned.description || submission.description;
      submission.bio = cleaned.bio || submission.bio;
      aiStatus = "success";
    } catch (err) {
      console.error("AI cleanup failed (continuing without):", err.message || err);
      aiStatus = `failed: ${err.message || err}`;
      submission.meta_title = `${submission.title} — Wedding Celebrant | Australian Wedding Celebrants`;
    }
    submission.ai_status = aiStatus;

    // Step 2: Always update status and send admin email
    submission.status = "pending_review";
    await env.KV.put(`submission:${submission.id}`, JSON.stringify(submission), { expirationTtl: 90 * 86400 });

    const adminToken = generateToken();
    await env.KV.put(`magic:${adminToken}`, JSON.stringify({
      email: env.ADMIN_EMAIL, type: "admin", created: Date.now(),
    }), { expirationTtl: 7 * 86400 });

    await sendEmail(env, {
      to: env.ADMIN_EMAIL,
      subject: `${submission.existing_slug ? "UPDATE" : "NEW LISTING"}: ${submission.title} (${submission.location.join(", ")})`,
      html: adminNotificationHtml(submission, adminToken, env),
    });
  })();

  // Keep the worker alive until background work completes
  ctx.waitUntil(backgroundWork);

  return htmlResponse(pageShell("Submission Received", `
    <h1>Thanks, ${esc(submission.title)}!</h1>
    <p>Your listing has been submitted for review. We'll clean it up and get back to you soon.</p>
    <div class="info-box mt-6">
      <h3>Want to fast-track your listing?</h3>
      <p>Listings are free and processed in order. If you'd like to make your listing a priority, you can make a contribution via PayID to <strong>pay@withers.co</strong>. This is entirely optional and doesn't affect your listing or tier.</p>
    </div>
    <a href="${env.SITE_URL}" class="btn btn-dark mt-6">Back to site</a>
  `));
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Edit — Interactive bio editing via Claude
// ─────────────────────────────────────────────────────────────────────────────

async function handleAiEdit(request, env, session) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { bio, edit_type, title, brand_name, description, website, location, category } = body;

  if (!bio || !edit_type) {
    return jsonResponse({ error: "bio and edit_type are required" }, 400);
  }

  const validTypes = ["better", "longer", "shorter", "helpful"];
  if (!validTypes.includes(edit_type)) {
    return jsonResponse({ error: "edit_type must be one of: " + validTypes.join(", ") }, 400);
  }

  // Scrape their website for context
  let websiteText = "";
  if (website && isSafeUrl(website)) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(website, { signal: controller.signal, headers: { "User-Agent": "AWC-Bot/1.0" } });
      clearTimeout(timeout);
      if (res.ok) {
        const html = await res.text();
        websiteText = extractTextFromHtml(html).substring(0, 3000);
      }
    } catch { /* ignore scraping failures */ }
  }

  const locationStr = Array.isArray(location) ? location.join(", ") : (location || "");
  const categoryStr = Array.isArray(category) ? category.join(", ") : (category || "");

  const contextBlock = `Celebrant name: ${title || ""}
Brand name: ${brand_name || title || ""}
Location: ${locationStr}
Categories: ${categoryStr}
Short description: ${description || "(not provided)"}
${websiteText ? `\nContent from their website:\n${websiteText}` : ""}`;

  const editInstructions = {
    better: "Improve the writing quality, flow, and professionalism of this bio. Keep all the same facts but make it more engaging, polished, and detailed. Target at least 600 words. Draw on website content to enrich the bio with additional detail about their services, approach, and experience.",
    longer: "Significantly expand this bio with more detail and depth. Target at least 600 words. Draw heavily on the website content for additional relevant facts about their services, approach, experience, style, areas served, and what couples can expect. Add paragraphs covering different aspects of their work.",
    shorter: "Condense this bio to be more concise while keeping the most important information. Aim for 3-4 tight paragraphs, around 300 words.",
    helpful: "Rewrite this bio to be maximally helpful to couples looking for a marriage celebrant. Target at least 600 words. Focus on what makes this celebrant a great choice, their experience, their approach to ceremonies, the areas they serve, and what couples can expect when working with them. Draw on website content for detail.",
  };

  const prompt = `You are helping rewrite a wedding celebrant's bio for the Australian Wedding Celebrants directory.

${contextBlock}

Their current bio:
${bio}

Task: ${editInstructions[edit_type]}

Rules:
- Write in Australian English (use "s" not "z" in words like "personalised", "specialising", etc.)
- Use Markdown formatting (bold, paragraphs, etc.)
- Write in third person
- Do NOT invent facts — only use information from the provided context and their website
- The audience is couples looking for a Commonwealth authorised marriage celebrant in Australia
- Be warm and professional
- Do NOT start with a heading (# or ##) — the bio sits below the celebrant's name on the page, so just start with body text
- Unless the task says otherwise, target at least 600 words — a rich, detailed bio helps celebrants get found by search engines and AI answer engines

Return ONLY the new bio text in markdown. No JSON, no code fences, no explanation.`;

  // Call Claude
  const models = ["claude-haiku-4-5-20251001", "claude-3-5-haiku-20241022", "claude-sonnet-4-5-20250514"];
  let result = null;
  let usage = null;
  let modelUsed = null;

  for (const model of models) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (res.ok) {
      const data = await res.json();
      result = data.content[0].text.trim();
      usage = data.usage;
      modelUsed = model;
      break;
    }
    console.error(`AI edit model ${model} failed:`, await res.text());
  }

  if (!result) {
    return jsonResponse({ error: "All AI models failed. Please try again." }, 500);
  }

  // Calculate cost (200x markup for retail)
  // Haiku 4.5: $0.80/MTok input, $4.00/MTok output
  const inputCost = (usage.input_tokens || 0) * 0.80 / 1_000_000;
  const outputCost = (usage.output_tokens || 0) * 4.00 / 1_000_000;
  const cost = 200 * (inputCost + outputCost);

  // Track cumulative usage
  let totalCost = cost;
  let callCount = 1;
  try {
    const existing = await env.KV.get(`ai_usage:${session.email}`, { type: "json" });
    if (existing) {
      totalCost = existing.total_cost + cost;
      callCount = existing.call_count + 1;
    }
    await env.KV.put(`ai_usage:${session.email}`, JSON.stringify({
      total_cost: totalCost, call_count: callCount, last_used: Date.now(),
    }), { expirationTtl: 90 * 86400 });
  } catch { /* ignore tracking failures */ }

  return jsonResponse({ bio: result, cost, total_cost: totalCost, model: modelUsed });
}

// ─────────────────────────────────────────────────────────────────────────────
// Asset proxy — serves images from private GitHub repo
// ─────────────────────────────────────────────────────────────────────────────

async function handleAssetProxy(request, env, session) {
  const url = new URL(request.url);
  const filePath = url.searchParams.get("path");
  if (!filePath) return new Response("Missing path", { status: 400 });

  // Sanitise — only allow files under src/assets/
  if (!filePath.startsWith("src/assets/") || filePath.includes("..")) {
    return new Response("Invalid path", { status: 400 });
  }

  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${filePath}?ref=${env.GITHUB_BRANCH}`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3.raw",
      "User-Agent": "AWC-Worker",
    },
  });

  if (!res.ok) return new Response("Image not found", { status: 404 });

  const ext = filePath.split(".").pop().toLowerCase();
  const mimeTypes = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", avif: "image/avif",
  };

  const contentType = mimeTypes[ext] || "application/octet-stream";
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=3600",
  };
  if (contentType.includes("svg")) {
    headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'";
    headers["X-Content-Type-Options"] = "nosniff";
  }
  return new Response(res.body, { headers });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — Dashboard
// ─────────────────────────────────────────────────────────────────────────────

async function handleAdminDashboard(request, env, session) {
  // Count pending submissions
  const subList = await env.KV.list({ prefix: "submission:" });
  let pendingCount = 0;
  let recentSubmissions = [];

  for (const key of subList.keys) {
    const raw = await env.KV.get(key.name);
    if (!raw) continue;
    const s = JSON.parse(raw);
    if (s.status === "pending_review") pendingCount++;
    recentSubmissions.push(s);
  }

  recentSubmissions.sort((a, b) => (b.submitted_at || "").localeCompare(a.submitted_at || ""));
  recentSubmissions = recentSubmissions.slice(0, 5);

  // Count listings from GitHub
  let listingCount = 0;
  try {
    const listings = await getGitHubListings(env);
    listingCount = listings.length;
  } catch { /* ignore */ }

  const recentHtml = recentSubmissions.length ? recentSubmissions.map(s => `
    <div class="card-item">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <strong>${esc(s.title)}</strong>
          <span class="status-badge status-${s.status}">${statusLabel(s.status)}</span>
        </div>
        <span class="text-sm text-light">${formatDate(s.submitted_at)}</span>
      </div>
      <div class="text-sm text-light mt-2">${esc(s.email)} · ${esc(s.location?.join(", ") || "")} · ${s.existing_slug ? "Update" : "New"}</div>
      ${s.status === "pending_review" ? `<a href="/admin/review?id=${s.id}" class="btn btn-sm btn-primary mt-2">Review</a>` : ""}
    </div>
  `).join("") : "<p class='text-light'>No submissions yet.</p>";

  const body = `
    <h1>Admin Dashboard</h1>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number">${pendingCount}</div>
        <div class="stat-label">Pending Review</div>
        ${pendingCount > 0 ? `<a href="/admin/review" class="btn btn-sm btn-primary mt-2">Review Now</a>` : ""}
      </div>
      <div class="stat-card">
        <div class="stat-number">${listingCount}</div>
        <div class="stat-label">Total Listings</div>
        <a href="/admin/listings" class="btn btn-sm btn-dark mt-2">View All</a>
      </div>
      <div class="stat-card">
        <div class="stat-number">${subList.keys.length}</div>
        <div class="stat-label">Total Submissions</div>
        <a href="/admin/submissions" class="btn btn-sm btn-dark mt-2">View All</a>
      </div>
    </div>

    <h2 class="mt-6" style="font-size:18px;font-weight:600;">Recent Submissions</h2>
    ${recentHtml}
  `;

  return htmlResponse(adminPageShell("Dashboard", body, "dashboard"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — Review & Approve
// ─────────────────────────────────────────────────────────────────────────────

async function handleAdminReview(request, env, session) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    // List all pending submissions
    const list = await env.KV.list({ prefix: "submission:" });
    const submissions = [];
    for (const key of list.keys) {
      const raw = await env.KV.get(key.name);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.status === "pending_review") submissions.push(s);
      }
    }

    if (!submissions.length) {
      return htmlResponse(adminPageShell("Review", "<h1>No pending submissions</h1><p>Nothing to review right now.</p><a href='/admin' class='btn btn-dark mt-4'>Back to Dashboard</a>", "review"));
    }

    const listHtml = submissions.map(s => `
      <div class="card-item">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong>${esc(s.title)}</strong>
            <span class="text-sm text-light" style="margin-left:8px;">${s.existing_slug ? "Update" : "New"}</span>
          </div>
          <span class="text-sm text-light">${formatDate(s.submitted_at)}</span>
        </div>
        <div class="text-sm text-light mt-2">${esc(s.email)} · ${esc(s.location?.join(", ") || "")}</div>
        <a href="/admin/review?id=${s.id}" class="btn btn-sm btn-primary mt-2">Review</a>
      </div>
    `).join("");

    return htmlResponse(adminPageShell("Review Queue", `<h1>Pending Submissions (${submissions.length})</h1>${listHtml}`, "review"));
  }

  // Show single submission for review
  const raw = await env.KV.get(`submission:${id}`);
  if (!raw) return htmlResponse(adminPageShell("Not Found", "<h1>Submission not found</h1>", "review"), 404);

  const s = JSON.parse(raw);
  return htmlResponse(adminPageShell(`Review: ${s.title}`, adminReviewHtml(s, env), "review"));
}

async function handleAdminApprove(request, env, session) {
  const form = await request.formData();
  const id = form.get("id");

  const raw = await env.KV.get(`submission:${id}`);
  if (!raw) return htmlResponse(adminPageShell("Error", "<h1>Submission not found</h1>", "review"), 404);

  const submission = JSON.parse(raw);

  // Allow admin to override fields from the review form
  submission.title = (form.get("title") || submission.title).trim();
  submission.meta_title = (form.get("meta_title") || submission.meta_title || "").trim();
  submission.description = (form.get("description") || submission.description).trim();
  submission.bio = (form.get("bio") || submission.bio).trim();
  const tier = form.get("tier") || "registered";
  const featured = form.get("featured") === "on";

  // Generate slug
  const slug = submission.existing_slug || slugify(submission.brand_name || submission.title) + "-" + generateShortId();

  // Push uploaded images to GitHub first
  try {
    if (submission.has_image_upload) {
      const imageData = await env.KV.get(`image:${id}`, { type: "json" });
      if (imageData) {
        const imagePath = `src/assets/directory/${slug}.${imageData.ext}`;
        await pushBinaryToGitHub(env, imagePath, imageData.base64, `feat(assets): add image for ${submission.title}`);
        submission.image = `../../assets/directory/${slug}.${imageData.ext}`;
        await env.KV.delete(`image:${id}`);
      }
    }

    if (submission.has_logo_upload) {
      const logoData = await env.KV.get(`logo:${id}`, { type: "json" });
      if (logoData) {
        const logoPath = `src/assets/directory/${slug}-logo.${logoData.ext}`;
        await pushBinaryToGitHub(env, logoPath, logoData.base64, `feat(assets): add logo for ${submission.title}`);
        submission.logo = `../../assets/directory/${slug}-logo.${logoData.ext}`;
        await env.KV.delete(`logo:${id}`);
      }
    }
  } catch (err) {
    console.error("Image push failed:", err);
  }

  // Generate frontmatter and push listing
  const frontmatter = buildFrontmatter(submission, tier, featured);
  const fileContent = frontmatter + "\n" + (submission.bio || "");

  try {
    await pushToGitHub(env, slug, fileContent, submission.existing_slug ? "update" : "add", submission.title);
  } catch (err) {
    console.error("GitHub push failed:", err);
    return htmlResponse(adminPageShell("Error", `
      <h1>GitHub push failed</h1>
      <p>${esc(err.message)}</p>
      <pre style="overflow:auto;font-size:12px;background:#f7f7f7;padding:12px;border-radius:8px;">${esc(fileContent)}</pre>
      <p>You can manually create the file at <code>${env.CONTENT_PATH}/${slug}.md</code></p>
    `, "review"), 500);
  }

  // Update submission status
  submission.status = "approved";
  submission.approved_at = new Date().toISOString();
  submission.approved_slug = slug;
  submission.approved_tier = tier;
  await env.KV.put(`submission:${id}`, JSON.stringify(submission), { expirationTtl: 90 * 86400 });

  // Store email→slug mapping
  await env.KV.put(`email:${submission.email}`, slug);

  // Schedule delayed notification (15 min)
  await env.KV.put(`notify:${id}`, JSON.stringify({
    submission_id: id, approved_at: Date.now(), slug, tier,
  }), { expirationTtl: 3600 });

  return htmlResponse(adminPageShell("Approved", `
    <h1>Listing approved</h1>
    <p><strong>${esc(submission.title)}</strong> has been pushed to GitHub as <code>${slug}.md</code>.</p>
    <p>The celebrant will be notified in ~15 minutes.</p>
    <div style="display:flex;gap:8px;margin-top:16px;">
      <a href="/admin/review" class="btn btn-dark">Review More</a>
      <a href="/admin" class="btn btn-sm" style="border:1px solid #e0e0e0;background:#fff;">Dashboard</a>
    </div>
  `, "review"));
}

async function handleAdminReject(request, env, session) {
  const form = await request.formData();
  const id = form.get("id");
  const reason = (form.get("reason") || "").trim();
  const shouldNotify = form.get("notify") === "yes";

  const raw = await env.KV.get(`submission:${id}`);
  if (!raw) return htmlResponse(adminPageShell("Error", "<h1>Submission not found</h1>", "review"), 404);

  const submission = JSON.parse(raw);

  // Update submission status
  submission.status = "rejected";
  submission.rejected_at = new Date().toISOString();
  submission.rejection_reason = reason;
  submission.rejection_notified = shouldNotify;
  await env.KV.put(`submission:${id}`, JSON.stringify(submission), { expirationTtl: 90 * 86400 });

  // Send rejection email if requested
  if (shouldNotify) {
    try {
      await sendEmail(env, {
        to: submission.email,
        subject: `Update on your listing submission — ${submission.title}`,
        html: celebrantRejectionHtml(submission, reason, env),
      });
    } catch (err) {
      console.error("Failed to send rejection email:", err);
      return htmlResponse(adminPageShell("Rejected (email failed)", `
        <h1>Listing rejected</h1>
        <p><strong>${esc(submission.title)}</strong> has been rejected, but the notification email failed to send.</p>
        <p class="text-sm text-light">Error: ${esc(err.message)}</p>
        <div style="display:flex;gap:8px;margin-top:16px;">
          <a href="/admin/review" class="btn btn-dark">Review More</a>
          <a href="/admin" class="btn btn-sm" style="border:1px solid #e0e0e0;background:#fff;">Dashboard</a>
        </div>
      `, "review"));
    }
  }

  return htmlResponse(adminPageShell("Rejected", `
    <h1>Listing rejected</h1>
    <p><strong>${esc(submission.title)}</strong> has been rejected${shouldNotify ? " and the celebrant has been notified by email" : " silently (no email sent)"}.</p>
    ${reason ? `<div class="info-box mt-4"><h3>Reason${shouldNotify ? " sent" : ""}</h3><p>${esc(reason).replace(/\n/g, "<br/>")}</p></div>` : ""}
    <div style="display:flex;gap:8px;margin-top:16px;">
      <a href="/admin/review" class="btn btn-dark">Review More</a>
      <a href="/admin" class="btn btn-sm" style="border:1px solid #e0e0e0;background:#fff;">Dashboard</a>
    </div>
  `, "review"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — Listings (from GitHub)
// ─────────────────────────────────────────────────────────────────────────────

async function handleAdminListings(request, env, session) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const perPage = 25;

  const allFiles = await getGitHubListings(env);
  const totalPages = Math.ceil(allFiles.length / perPage);
  const pageFiles = allFiles.slice((page - 1) * perPage, page * perPage);

  // Fetch frontmatter for current page items in parallel
  const details = await Promise.all(
    pageFiles.map(async (file) => {
      const slug = file.name.replace(/\.md$/, "");
      try {
        const fileData = await fetchFileFromGitHub(env, slug);
        if (fileData) {
          const fm = parseFrontmatter(fileData.content);
          return { slug, title: fm.title || slug, tier: fm.tier || "registered", location: fm.location || [], email: fm.email || "" };
        }
      } catch { /* ignore */ }
      return { slug, title: slug, tier: "registered", location: [], email: "" };
    })
  );

  const listHtml = details.map(d => `
    <div class="card-item" style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <strong>${esc(d.title)}</strong>
        <span class="tier-badge tier-${d.tier}">${d.tier}</span>
        <div class="text-sm text-light">${esc(d.location.join(", ") || "No location")} · ${esc(d.email)}</div>
      </div>
      <div style="display:flex;gap:6px;">
        <a href="/admin/edit?slug=${encodeURIComponent(d.slug)}" class="btn btn-sm btn-dark">Edit</a>
        <a href="${env.SITE_URL}/directory/${d.slug}/" target="_blank" class="btn btn-sm" style="border:1px solid #e0e0e0;background:#fff;">View</a>
      </div>
    </div>
  `).join("");

  // Pagination
  let paginationHtml = "";
  if (totalPages > 1) {
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i === page
        ? `<span class="btn btn-sm btn-dark">${i}</span>`
        : `<a href="/admin/listings?page=${i}" class="btn btn-sm" style="border:1px solid #e0e0e0;background:#fff;">${i}</a>`
      );
    }
    paginationHtml = `<div style="display:flex;gap:4px;justify-content:center;margin-top:16px;">${pages.join("")}</div>`;
  }

  const body = `
    <h1>All Listings (${allFiles.length})</h1>
    ${listHtml}
    ${paginationHtml}
  `;

  return htmlResponse(adminPageShell("Listings", body, "listings"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — Submissions (all statuses)
// ─────────────────────────────────────────────────────────────────────────────

async function handleAdminSubmissions(request, env, session) {
  const list = await env.KV.list({ prefix: "submission:" });
  const submissions = [];

  for (const key of list.keys) {
    const raw = await env.KV.get(key.name);
    if (raw) submissions.push(JSON.parse(raw));
  }

  submissions.sort((a, b) => (b.submitted_at || "").localeCompare(a.submitted_at || ""));

  const listHtml = submissions.length ? submissions.map(s => `
    <div class="card-item">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <strong>${esc(s.title)}</strong>
          <span class="status-badge status-${s.status}">${statusLabel(s.status)}</span>
          <span class="text-sm text-light" style="margin-left:4px;">${s.existing_slug ? "Update" : "New"}</span>
        </div>
        <span class="text-sm text-light">${formatDate(s.submitted_at)}</span>
      </div>
      <div class="text-sm text-light mt-2">${esc(s.email)} · ${esc(s.location?.join(", ") || "")}</div>
      <div style="display:flex;gap:6px;margin-top:8px;">
        ${s.status === "pending_review" ? `<a href="/admin/review?id=${s.id}" class="btn btn-sm btn-primary">Review</a>` : ""}
        ${s.status === "approved" && s.approved_slug ? `<a href="${env.SITE_URL}/directory/${s.approved_slug}/" target="_blank" class="btn btn-sm" style="border:1px solid #e0e0e0;background:#fff;">View Listing</a>` : ""}
      </div>
    </div>
  `).join("") : "<p class='text-light'>No submissions found.</p>";

  return htmlResponse(adminPageShell("Submissions", `<h1>All Submissions (${submissions.length})</h1>${listHtml}`, "submissions"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — Edit Listing (direct GitHub edit)
// ─────────────────────────────────────────────────────────────────────────────

async function handleAdminEdit(request, env, session) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");

  if (!slug) return redirect("/admin/listings");

  const file = await fetchFileFromGitHub(env, slug);
  if (!file) {
    return htmlResponse(adminPageShell("Not Found", `<h1>Listing not found</h1><p>No listing found with slug: ${esc(slug)}</p>`, "listings"), 404);
  }

  const existing = parseFrontmatter(file.content);
  existing._body = parseBody(file.content);

  return htmlResponse(adminPageShell(`Edit: ${existing.title || slug}`, adminEditFormHtml(slug, existing, env), "listings"));
}

async function handleAdminEditSave(request, env, session, ctx) {
  const form = await request.formData();
  const slug = (form.get("slug") || "").trim();

  if (!slug) return redirect("/admin/listings");

  // Handle file uploads
  const imageFile = form.get("image_file");
  const logoFile = form.get("logo_file");
  let newImagePath = null;
  let newLogoPath = null;

  if (imageFile && imageFile.size > 0) {
    let imageData;
    if (isSvg(imageFile)) {
      const buffer = await imageFile.arrayBuffer();
      imageData = { base64: arrayBufferToBase64(buffer), ext: "svg" };
    } else {
      const optimised = await optimiseImage(imageFile, { maxWidth: 1200, quality: 82 });
      imageData = { base64: optimised.base64, ext: "webp" };
    }
    const imagePath = `src/assets/directory/${slug}.${imageData.ext}`;
    await pushBinaryToGitHub(env, imagePath, imageData.base64, `update(assets): update image for ${form.get("title") || slug}`);
    newImagePath = `../../assets/directory/${slug}.${imageData.ext}`;
  }

  if (logoFile && logoFile.size > 0) {
    let logoData;
    if (isSvg(logoFile)) {
      const buffer = await logoFile.arrayBuffer();
      logoData = { base64: arrayBufferToBase64(buffer), ext: "svg" };
    } else {
      const optimised = await optimiseImage(logoFile, { maxWidth: 600, quality: 90 });
      logoData = { base64: optimised.base64, ext: "webp" };
    }
    const logoPath = `src/assets/directory/${slug}-logo.${logoData.ext}`;
    await pushBinaryToGitHub(env, logoPath, logoData.base64, `update(assets): update logo for ${form.get("title") || slug}`);
    newLogoPath = `../../assets/directory/${slug}-logo.${logoData.ext}`;
  }

  const submission = {
    title: (form.get("title") || "").trim(),
    brand_name: (form.get("brand_name") || "").trim(),
    meta_title: (form.get("meta_title") || "").trim(),
    description: (form.get("description") || "").trim(),
    bio: (form.get("bio") || "").trim(),
    email: (form.get("email") || "").trim(),
    website: (form.get("website") || "").trim(),
    phone: (form.get("phone") || "").trim(),
    address: (form.get("address") || "").trim(),
    image: newImagePath || (form.get("existing_image") || "").trim() || null,
    logo: newLogoPath || (form.get("existing_logo") || "").trim() || null,
    location: (form.get("location") || "").split(",").map(s => s.trim()).filter(Boolean),
    category: form.getAll("category").filter(Boolean),
    australia_wide: form.get("australia_wide") === "on",
    international: form.get("international") === "on",
    // Checkbox checked → explicit opt in. Unchecked or missing → not opted in.
    accepts_agent_enquiries: form.get("opt_enquiries_present") === "1"
      ? form.get("accepts_agent_enquiries") === "on"
      : false,
    year_started: parseYearStarted(form.get("year_started")),
    social: {
      facebook: (form.get("facebook") || "").trim(),
      instagram: (form.get("instagram") || "").trim(),
      pinterest: (form.get("pinterest") || "").trim(),
    },
  };

  const tier = form.get("tier") || "registered";
  const featured = form.get("featured") === "on";

  const frontmatter = buildFrontmatter(submission, tier, featured);
  const fileContent = frontmatter + "\n" + (submission.bio || "");

  try {
    await pushToGitHub(env, slug, fileContent, "update", submission.title);
  } catch (err) {
    return htmlResponse(adminPageShell("Error", `
      <h1>GitHub push failed</h1>
      <p>${esc(err.message)}</p>
    `, "listings"), 500);
  }

  // Update email→slug mapping
  if (submission.email) {
    await env.KV.put(`email:${submission.email}`, slug);
  }

  return htmlResponse(adminPageShell("Saved", `
    <h1>Listing updated</h1>
    <p><strong>${esc(submission.title)}</strong> has been saved to GitHub.</p>
    <div style="display:flex;gap:8px;margin-top:16px;">
      <a href="/admin/edit?slug=${encodeURIComponent(slug)}" class="btn btn-dark">Edit Again</a>
      <a href="${env.SITE_URL}/directory/${slug}/" target="_blank" class="btn btn-sm" style="border:1px solid #e0e0e0;background:#fff;">View Listing</a>
      <a href="/admin/listings" class="btn btn-sm" style="border:1px solid #e0e0e0;background:#fff;">All Listings</a>
    </div>
  `, "listings"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — Image proxy for submission images in KV
// ─────────────────────────────────────────────────────────────────────────────

async function handleAdminImage(request, env, session) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const ALLOWED_IMAGE_TYPES = ["image", "logo", "evidence"];
  const typeParam = url.searchParams.get("type") || "image";
  const type = ALLOWED_IMAGE_TYPES.includes(typeParam) ? typeParam : "image";
  const indexRaw = parseInt(url.searchParams.get("index") || "0", 10);
  const index = Number.isFinite(indexRaw) && indexRaw >= 0 ? indexRaw : 0;
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";

  if (!id || !/^[a-f0-9]+$/.test(id)) return new Response("Invalid id", { status: 400 });

  const kvKey = `${type}:${id}`;
  const raw = await env.KV.get(kvKey, { type: "json" });
  if (!raw) return new Response("Not found", { status: 404 });

  // Evidence is stored as an array of file objects; image/logo as a single object
  const data = Array.isArray(raw) ? raw[index] : raw;
  if (!data?.base64) return new Response("No file data", { status: 404 });

  const binary = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0));
  const contentType = data.type || (type === "evidence" ? "application/octet-stream" : "image/webp");
  const safeName = (data.name || `${type}-${index}.${data.ext || "bin"}`).replace(/[^\w.\- ]/g, "_");
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=300",
    "Content-Disposition": `${disposition}; filename="${safeName}"`,
  };
  // SVG can contain scripts — neuter them
  if (contentType.includes("svg")) {
    headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'";
    headers["X-Content-Type-Options"] = "nosniff";
  }
  return new Response(binary, { headers });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — Bulk Email
// ─────────────────────────────────────────────────────────────────────────────

async function handleAdminEmail(request, env, session) {
  // Count recipients
  let recipientCount = 0;
  try {
    const listings = await getGitHubListings(env);
    recipientCount = listings.length;
  } catch { /* ignore */ }

  const body = `
    <h1>Email All Celebrants</h1>
    <p class="text-light">Send an email to all ${recipientCount} listed celebrants. Each email is sent individually.</p>

    <form id="email-form" class="space-y-4 mt-6">
      <div>
        <label class="label" for="email_subject">Subject</label>
        <input class="input" type="text" id="email_subject" name="subject" required placeholder="e.g. Important update from Australian Wedding Celebrants" />
      </div>
      <div>
        <label class="label" for="email_body">Message body</label>
        <textarea class="textarea" id="email_body" name="body" rows="12" required placeholder="Write your message here. Use **bold** for emphasis. Line breaks are preserved."></textarea>
        <p class="hint">Plain text with basic formatting. Use **bold** for emphasis. Line breaks are preserved.</p>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" id="ai-cleanup-btn" class="btn btn-sm" style="border:1px solid #e0e0e0;background:#fff;">Cleanup with AI</button>
        <button type="button" id="preview-btn" class="btn btn-sm" style="border:1px solid #e0e0e0;background:#fff;">Preview</button>
      </div>

      <div id="ai-status" style="display:none;" class="text-sm text-light"></div>

      <div id="preview-area" style="display:none;border:1px solid #e0e0e0;border-radius:12px;padding:20px;margin-top:8px;">
        <p class="text-sm text-light" style="margin-bottom:8px;font-weight:600;">Preview:</p>
        <div id="preview-content"></div>
      </div>

      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-top:16px;">
        <p style="font-size:14px;font-weight:600;color:#dc2626;margin-bottom:4px;">This will send to ${recipientCount} celebrants</p>
        <p class="hint" style="margin:0;">Each email is sent individually with a 1-second delay. This action cannot be undone.</p>
      </div>

      <button type="button" id="send-btn" class="btn btn-primary w-full" onclick="confirmSend()">Send to All Celebrants</button>
    </form>

    <div id="send-progress" style="display:none;" class="mt-6">
      <div class="info-box">
        <h3>Sending in progress...</h3>
        <p id="send-status">Your emails are being sent in the background. You can close this page.</p>
      </div>
    </div>

    <script>
      document.getElementById('ai-cleanup-btn').addEventListener('click', async function() {
        const btn = this;
        const body = document.getElementById('email_body').value;
        if (!body.trim()) { alert('Write a message first'); return; }

        btn.disabled = true;
        btn.textContent = 'Cleaning up...';
        document.getElementById('ai-status').style.display = 'block';
        document.getElementById('ai-status').textContent = 'Running AI cleanup...';

        try {
          const res = await fetch('/admin/ai-cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: body }),
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          document.getElementById('email_body').value = data.text;
          document.getElementById('ai-status').textContent = 'Cleanup complete.';
        } catch (err) {
          document.getElementById('ai-status').textContent = 'Cleanup failed: ' + err.message;
        }
        btn.disabled = false;
        btn.textContent = 'Cleanup with AI';
      });

      document.getElementById('preview-btn').addEventListener('click', function() {
        const body = document.getElementById('email_body').value;
        let html = body
          .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        // Links — sanitise href to prevent javascript: injection
        html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function(_, label, url) {
          const trimmed = url.replace(/\\s/g, '');
          if (/^https?:\\/\\//i.test(trimmed)) return '<a href="' + trimmed.replace(/"/g, '&quot;') + '" style="color:#2563eb">' + label + '</a>';
          return label;
        });
        // Bold then italic
        html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
        html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
        // Headers
        html = html.replace(/^### (.+)$/gm, '<h3 style="margin:16px 0 8px">$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2 style="margin:16px 0 8px">$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1 style="margin:16px 0 8px">$1</h1>');
        // Lists
        html = html.replace(/^(?:[*-]) (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\\/li>\\n?)+/g, '<ul style="margin:8px 0;padding-left:24px">$&</ul>');
        // Line breaks and cleanup
        html = html.replace(/\\n/g, '<br>');
        html = html.replace(/<br>(<\\/?(?:ul|li|h[1-3]))/g, '$1');
        html = html.replace(/(<\\/(?:ul|h[1-3])>)<br>/g, '$1');
        document.getElementById('preview-content').innerHTML = html;
        document.getElementById('preview-area').style.display = 'block';
      });

      async function confirmSend() {
        const subject = document.getElementById('email_subject').value.trim();
        const body = document.getElementById('email_body').value.trim();
        if (!subject || !body) { alert('Subject and body are required'); return; }
        if (!confirm('Are you sure you want to send this email to ALL listed celebrants? This cannot be undone.')) return;

        document.getElementById('send-btn').disabled = true;
        document.getElementById('send-btn').textContent = 'Sending...';

        try {
          const form = new FormData();
          form.append('subject', subject);
          form.append('body', body);

          const res = await fetch('/admin/email', {
            method: 'POST',
            body: form,
          });

          if (res.ok) {
            document.getElementById('email-form').style.display = 'none';
            document.getElementById('send-progress').style.display = 'block';
            const data = await res.json();
            document.getElementById('send-status').textContent = data.message || 'Emails queued for sending.';
          } else {
            const err = await res.text();
            alert('Send failed: ' + err);
            document.getElementById('send-btn').disabled = false;
            document.getElementById('send-btn').textContent = 'Send to All Celebrants';
          }
        } catch (err) {
          alert('Error: ' + err.message);
          document.getElementById('send-btn').disabled = false;
          document.getElementById('send-btn').textContent = 'Send to All Celebrants';
        }
      }
    </script>
  `;

  return htmlResponse(adminPageShell("Email All", body, "email"));
}

async function handleAdminEmailSend(request, env, session, ctx) {
  const form = await request.formData();
  const subject = (form.get("subject") || "").trim();
  const body = (form.get("body") || "").trim();

  if (!subject || !body) {
    return new Response("Subject and body are required", { status: 400 });
  }

  // Fetch all listing emails from GitHub
  const listings = await getGitHubListings(env);
  const emails = new Set();

  for (const file of listings) {
    const slug = file.name.replace(/\.md$/, "");
    try {
      const fileData = await fetchFileFromGitHub(env, slug);
      if (fileData) {
        const fm = parseFrontmatter(fileData.content);
        if (fm.email) emails.add(fm.email.toLowerCase());
      }
    } catch { /* ignore */ }
  }

  const recipientList = [...emails];

  // Store send record
  const blastId = Date.now().toString();
  await env.KV.put(`email_blast:${blastId}`, JSON.stringify({
    subject, body, recipient_count: recipientList.length,
    sent_at: new Date().toISOString(), status: "sending",
  }), { expirationTtl: 90 * 86400 });

  // Send in background with delays
  const backgroundSend = (async () => {
    let sent = 0;
    let failed = 0;

    // Format body as light HTML
    const htmlBody = formatBulkEmailBody(body);

    for (const email of recipientList) {
      try {
        await sendEmail(env, {
          to: email,
          subject,
          html: emailShell(htmlBody),
        });
        sent++;
      } catch (err) {
        console.error(`Failed to send to ${email}:`, err.message);
        failed++;
      }
      // 1-second delay between sends
      await new Promise(r => setTimeout(r, 1000));
    }

    // Update send record
    await env.KV.put(`email_blast:${blastId}`, JSON.stringify({
      subject, body, recipient_count: recipientList.length,
      sent_at: new Date().toISOString(), status: "complete",
      sent, failed,
    }), { expirationTtl: 90 * 86400 });
  })();

  ctx.waitUntil(backgroundSend);

  return jsonResponse({
    message: `Queued ${recipientList.length} emails for sending. They will be sent with a 1-second delay between each.`,
    recipient_count: recipientList.length,
  });
}

async function handleAdminAiCleanup(request, env, session) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { text } = body;
  if (!text) return jsonResponse({ error: "text is required" }, 400);

  const prompt = `Fix the spelling, grammar, and formatting of the following email message. Write in Australian English (use "s" not "z" in words like "personalised", "organise", etc.). Keep the same tone and content. Use **bold** for emphasis where appropriate. Return ONLY the cleaned-up text, no explanation.

${text}`;

  const models = ["claude-haiku-4-5-20251001", "claude-3-5-haiku-20241022"];
  for (const model of models) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return jsonResponse({ text: data.content[0].text.trim() });
    }
  }

  return jsonResponse({ error: "AI cleanup failed" }, 500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Award nominations — public form from /awards/nominate/
//
// Two-step flow so the nominator can confirm Claude's suggested title and
// justification before anything hits Josh's inbox:
//   1. POST /award-nomination           → draft (runs Claude, returns JSON)
//   2. POST /award-nomination/send      → email (after the nominator confirms)
// ─────────────────────────────────────────────────────────────────────────────

function nominationCors(request, env) {
  return {
    "Content-Type": "application/json",
    ...corsHeaders(request, env),
  };
}

function nominationJson(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: nominationCors(request, env),
  });
}

function parseNominationForm(form) {
  return {
    celebrant: (form.get("celebrant") || "").trim(),
    nominator_name: (form.get("nominator_name") || "").trim(),
    nominator_email: (form.get("nominator_email") || "").trim().toLowerCase(),
    year: parseYearStarted(form.get("year")) || new Date().getUTCFullYear(),
    story: (form.get("story") || "").trim(),
    submitted_at: new Date().toISOString(),
  };
}

function validateNomination(n) {
  if (!n.celebrant) return "celebrant name required";
  if (!n.nominator_name) return "your name required";
  if (!isValidEmail(n.nominator_email)) return "valid email required";
  if (!n.story || n.story.length < 40) return "story must be at least 40 characters";
  return null;
}

async function handleAwardNominationDraft(request, env, ctx) {
  const form = await request.formData();

  // Honeypot — bot-filled hidden field, silently return a fake-success draft.
  if ((form.get("_hp") || "").trim()) {
    return nominationJson(request, env, { ok: true, honeypot: true });
  }

  const nomination = parseNominationForm(form);
  const err = validateNomination(nomination);
  if (err) return nominationJson(request, env, { error: err }, 400);

  // Rate limit — 5 draft requests per email per hour (Claude is the expensive bit)
  const rateKey = `ratelimit:nominate:${nomination.nominator_email}`;
  const attempts = parseInt(await env.KV.get(rateKey) || "0", 10);
  if (attempts >= 5) {
    return nominationJson(request, env, {
      error: "Too many nominations from this email. Please wait an hour and try again.",
    }, 429);
  }
  await env.KV.put(rateKey, String(attempts + 1), { expirationTtl: 3600 });

  let ai = null;
  try {
    ai = await generateAwardSuggestion(env, nomination);
  } catch (e) {
    console.error("Award AI failed:", e);
  }

  if (!ai || !Array.isArray(ai.suggestions) || ai.suggestions.length === 0) {
    return nominationJson(request, env, {
      error: "We couldn't draft a title right now. Please try again in a moment.",
    }, 502);
  }

  return nominationJson(request, env, {
    ok: true,
    justification: ai.justification || "",
    suggestions: ai.suggestions,
  });
}

async function handleAwardNominationSend(request, env, ctx) {
  const form = await request.formData();

  if ((form.get("_hp") || "").trim()) {
    return nominationJson(request, env, { ok: true, honeypot: true });
  }

  const nomination = parseNominationForm(form);
  const err = validateNomination(nomination);
  if (err) return nominationJson(request, env, { error: err }, 400);

  const chosenTitle = (form.get("chosen_title") || "").trim();
  const chosenEmoji = (form.get("chosen_emoji") || "🏆").trim();
  const justification = (form.get("justification") || "").trim();

  if (!chosenTitle) return nominationJson(request, env, { error: "Award title is required" }, 400);

  try {
    await sendEmail(env, {
      to: env.ADMIN_EMAIL,
      subject: `Award nomination: ${nomination.celebrant} — ${chosenTitle}`,
      html: awardNominationEmailHtml(nomination, { chosenTitle, chosenEmoji, justification }, env),
    });
  } catch (e) {
    console.error("Failed to send nomination email:", e);
    return nominationJson(request, env, { error: "Email send failed. Please try again." }, 500);
  }

  return nominationJson(request, env, { ok: true });
}

async function generateAwardSuggestion(env, nomination) {
  const prompt = `You're helping an Australian wedding directory turn a nomination into a Trophy Shelf award. The Trophy Shelf is deliberately playful — think "staff Christmas party awards" — but some awards are also genuinely serious (like "Celebrant of the Year — Hobart").

Nomination details:
- Celebrant: ${nomination.celebrant}
- Year the moment happened: ${nomination.year}
- Nominated by: ${nomination.nominator_name}
- What they did (in the nominator's words):
"""
${nomination.story}
"""

Return ONLY a JSON object (no prose, no code fences) with this exact shape:
{
  "justification": "ONE short sentence (max ~25 words, under 200 characters) suitable for publication beneath the award. Australian English. Specific and warm. No generic praise, no filler.",
  "suggestions": [
    { "title": "Playful but descriptive award title", "emoji": "single emoji", "tone": "fun" | "serious" },
    { "title": "Alternative title", "emoji": "single emoji", "tone": "fun" | "serious" },
    { "title": "Third option", "emoji": "single emoji", "tone": "fun" | "serious" }
  ]
}

Award title guidance:
- Keep titles SHORT and punchy — aim for 3–6 words, absolute max 40 characters. Think trophy engravings, not sentences.
- Titles should be fun and specific to what the celebrant did. Good examples: "Groom Tear-Jerker Award", "Dad-Joke Vows Champion", "Celebrant of the Year — Hobart", "Best Beach Ceremony".
- Avoid filler like "Most Likely to…", "The One Who…", "Award for…". Go straight to the hook.
- Offer at least one "fun" title. If the story clearly describes professional excellence tied to a region, include one "serious" option like "Celebrant of the Year — <Region>".
- Emoji should feel specific to the title (not always 🏆). One emoji only.`;

  const models = ["claude-haiku-4-5-20251001", "claude-3-5-haiku-20241022"];
  for (const model of models) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) continue;
    const data = await res.json();
    const raw = data.content?.[0]?.text?.trim() || "";
    // Strip code fences if Claude wrapped the JSON despite instructions.
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && Array.isArray(parsed.suggestions)) return parsed;
    } catch (err) {
      console.warn("Award JSON parse failed:", err.message, raw);
    }
  }
  return null;
}

function awardNominationEmailHtml(n, confirmed, env) {
  const title = confirmed?.chosenTitle || "REPLACE_WITH_TITLE";
  const emoji = confirmed?.chosenEmoji || "🏆";
  const justification = confirmed?.justification || "";

  const yamlNote = justification ? justification.replace(/"/g, '\\"') : "";
  const yamlSnippet = `awards:
  - title: "${title.replace(/"/g, '\\"')}"
    emoji: "${emoji}"
    year: ${n.year}${yamlNote ? `
    note: "${yamlNote}"` : ""}`;

  return emailShell(`
    <div style="background:#222;color:#fff;padding:16px 24px;border-radius:8px;margin-bottom:24px;text-align:center;">
      <div style="font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;opacity:0.7;margin-bottom:4px;">Award Nomination</div>
      <div style="font-size:22px;font-weight:700;">${esc(n.celebrant)}</div>
      <div style="font-size:14px;opacity:0.8;margin-top:4px;">Year: ${esc(String(n.year))}</div>
    </div>

    <div style="text-align:center;padding:20px;background:#fdfaf6;border-radius:12px;margin-bottom:24px;">
      <div style="font-size:36px;line-height:1;margin-bottom:8px;">${esc(emoji)}</div>
      <div style="font-size:18px;font-weight:700;color:#222;letter-spacing:-0.2px;">${esc(title)}</div>
    </div>

    <p style="font-size:14px;color:#999;margin-bottom:16px;">Submitted: ${esc(n.submitted_at)}</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 0;color:#666;width:140px;vertical-align:top;">Nominated by</td><td style="padding:8px 0;color:#222;">${esc(n.nominator_name)}</td></tr>
      <tr><td style="padding:8px 0;color:#666;">Email</td><td style="padding:8px 0;color:#222;"><a href="mailto:${esc(n.nominator_email)}" style="color:#ff385c;">${esc(n.nominator_email)}</a></td></tr>
    </table>

    <h2 style="font-size:16px;font-weight:600;color:#222;margin:24px 0 8px;">Original nomination</h2>
    <div style="padding:16px;background:#f7f7f7;border-radius:8px;font-size:14px;color:#222;line-height:1.6;white-space:pre-wrap;">${esc(n.story)}</div>

    ${justification ? `
      <h2 style="font-size:16px;font-weight:600;color:#222;margin:24px 0 8px;">Confirmed justification</h2>
      <div style="padding:16px;background:#fdfaf6;border-radius:8px;font-size:14px;color:#222;line-height:1.6;font-style:italic;">${esc(justification)}</div>
    ` : ""}

    <h2 style="font-size:16px;font-weight:600;color:#222;margin:24px 0 8px;">Paste into listing frontmatter</h2>
    <pre style="padding:16px;background:#222;color:#fff;border-radius:8px;font-size:12px;line-height:1.6;overflow-x:auto;margin:0;"><code>${esc(yamlSnippet)}</code></pre>
    <p style="font-size:12px;color:#999;margin-top:8px;">If the listing already has an <code>awards:</code> block, add just the list item (the indented <code>- title: …</code> rows).</p>
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled — Delayed notification emails
// ─────────────────────────────────────────────────────────────────────────────

async function processDelayedNotifications(env) {
  const list = await env.KV.list({ prefix: "notify:" });
  const now = Date.now();
  const DELAY_MS = 15 * 60 * 1000; // 15 minutes

  for (const key of list.keys) {
    const raw = await env.KV.get(key.name);
    if (!raw) continue;

    const notify = JSON.parse(raw);
    if (now - notify.approved_at < DELAY_MS) continue; // not yet

    // Get the full submission
    const subRaw = await env.KV.get(`submission:${notify.submission_id}`);
    if (!subRaw) {
      await env.KV.delete(key.name);
      continue;
    }

    const submission = JSON.parse(subRaw);

    // Send celebrant notification
    try {
      await sendEmail(env, {
        to: submission.email,
        subject: `Your listing is live — ${submission.title}`,
        html: celebrantApprovalHtml(submission, notify, env),
      });
    } catch (err) {
      console.error("Failed to send notification:", err);
    }

    // Delete the notification key
    await env.KV.delete(key.name);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI — Content cleanup via Claude
// ─────────────────────────────────────────────────────────────────────────────

async function cleanupWithAI(env, submission) {
  // Scrape their website for extra context to build a rich 600+ word bio
  let websiteText = "";
  if (submission.website && isSafeUrl(submission.website)) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(submission.website, { signal: controller.signal, headers: { "User-Agent": "AWC-Bot/1.0" } });
      clearTimeout(timeout);
      if (res.ok) {
        const html = await res.text();
        websiteText = extractTextFromHtml(html).substring(0, 3000);
      }
    } catch (e) {
      console.log("Website scrape failed:", e.message);
    }
  }

  const prompt = `You are helping clean up a wedding celebrant's directory listing for the Australian Wedding Celebrants directory. Improve the writing to be engaging, warm, and professional. Use Australian English (use "s" not "z" in words like "personalised", "specialising", etc.). Do NOT invent facts. Use information from the provided context and their website content.

Celebrant name: ${submission.title}
Brand name: ${submission.brand_name || submission.title}
Location: ${submission.location.join(", ")}
Categories: ${submission.category.join(", ")}
${submission.australia_wide ? "Travels Australia wide." : ""}
${submission.international ? "Available for international destination weddings." : ""}

Their description (short): ${submission.description || "(not provided)"}
Their bio (long): ${submission.bio || "(not provided)"}
${websiteText ? `\nContent scraped from their website (${submission.website}):\n${websiteText}` : ""}

Return a JSON object with these fields:
- "title": the celebrant/brand display name (clean it up if needed, keep it as-is if fine)
- "meta_title": an SEO-friendly page title, format: "[Name] — [Location] Wedding Celebrant | Australian Wedding Celebrants"
- "description": a polished 1-2 sentence description (max 160 chars)
- "bio": a rich, detailed bio in markdown. TARGET LENGTH: 600+ words. Write in third person. Be warm but professional. Do NOT start with a heading (# or ##) — just start with body text. Use the website content to add detail about their services, style, experience, and approach. Structure with multiple paragraphs covering: who they are, their style/approach, their services, their experience, the areas they serve, and what couples can expect. The audience is couples looking for a Commonwealth authorised marriage celebrant in Australia.

Return ONLY valid JSON, no markdown fences.`;

  // Try models in order of preference
  const models = ["claude-haiku-4-5-20251001", "claude-3-5-haiku-20241022", "claude-sonnet-4-5-20250514"];
  let lastError = null;

  for (const model of models) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (res.ok) {
      const data = await res.json();
      let text = data.content[0].text.trim();
      // Strip markdown code fences if the model wraps the JSON
      text = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/,"");
      return JSON.parse(text);
    }

    lastError = await res.text();
    console.error(`Model ${model} failed:`, lastError);
  }

  throw new Error(`All AI models failed. Last error: ${lastError}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub — Fetch & Push files
// ─────────────────────────────────────────────────────────────────────────────

async function getGitHubListings(env) {
  // Check cache first
  const cached = await env.KV.get("cache:listings", { type: "json" });
  if (cached) return cached;

  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${env.CONTENT_PATH}?ref=${env.GITHUB_BRANCH}`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "AWC-Worker",
    },
  });

  if (!res.ok) throw new Error("Failed to list GitHub directory");
  const files = await res.json();
  const listings = files.filter(f => f.name.endsWith(".md") && !f.name.startsWith("-"));

  // Cache for 5 minutes
  await env.KV.put("cache:listings", JSON.stringify(listings), { expirationTtl: 300 });
  return listings;
}

async function findSlugByEmail(env, email) {
  const query = encodeURIComponent(`"${email}" path:${env.CONTENT_PATH}`);
  const res = await fetch(`https://api.github.com/search/code?q=${query}+repo:${env.GITHUB_REPO}`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "AWC-Worker",
    },
  });

  if (!res.ok) {
    console.error("GitHub search failed:", await res.text());
    return findSlugByEmailFallback(env, email);
  }

  const data = await res.json();
  if (data.items && data.items.length > 0) {
    const filePath = data.items[0].path;
    const match = filePath.match(/\/([^/]+)\.md$/);
    if (match && !match[1].startsWith("-")) return match[1];
  }

  return null;
}

async function findSlugByEmailFallback(env, email) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${env.CONTENT_PATH}?ref=${env.GITHUB_BRANCH}`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "AWC-Worker",
    },
  });

  if (!res.ok) return null;
  const files = await res.json();

  for (const file of files) {
    if (!file.name.endsWith(".md") || file.name.startsWith("-")) continue;

    const slug = file.name.replace(/\.md$/, "");
    const fileData = await fetchFileFromGitHub(env, slug);
    if (!fileData) continue;

    const frontmatter = parseFrontmatter(fileData.content);
    if (frontmatter.email?.toLowerCase() === email.toLowerCase()) {
      return slug;
    }
  }

  return null;
}

async function fetchFileFromGitHub(env, slug) {
  const path = `${env.CONTENT_PATH}/${slug}.md`;
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "AWC-Worker",
    },
  });

  if (!res.ok) return null;
  const data = await res.json();
  // Decode base64 → binary → UTF-8 (atob alone mangles non-ASCII like curly quotes)
  const binary = atob(data.content.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const content = new TextDecoder().decode(bytes);
  return { content, sha: data.sha, path: data.path };
}

async function pushToGitHub(env, slug, content, action, celebrantName) {
  const path = `${env.CONTENT_PATH}/${slug}.md`;
  const encoded = btoa(unescape(encodeURIComponent(content)));

  let sha = null;
  const existing = await fetchFileFromGitHub(env, slug);
  if (existing) sha = existing.sha;

  const body = {
    message: `${action === "update" ? "update" : "feat"}(directory): ${action} listing for ${celebrantName}`,
    content: encoded,
    branch: env.GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "AWC-Worker",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${err}`);
  }

  return await res.json();
}

async function pushBinaryToGitHub(env, filePath, base64Content, commitMessage) {
  let sha = null;
  const checkRes = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${filePath}?ref=${env.GITHUB_BRANCH}`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "AWC-Worker",
    },
  });
  if (checkRes.ok) {
    const data = await checkRes.json();
    sha = data.sha;
  }

  const body = {
    message: commitMessage,
    content: base64Content,
    branch: env.GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${filePath}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "AWC-Worker",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub image push error (${res.status}): ${err}`);
  }

  return await res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Email sending via Resend
// ─────────────────────────────────────────────────────────────────────────────

async function sendEmail(env, { to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Australian Wedding Celebrants <${env.FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
    throw new Error(`Email send failed: ${err}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontmatter builder
// ─────────────────────────────────────────────────────────────────────────────

// Parse a year_started form input into a positive integer or null. Accepts
// a plausible range (1950 to current year + 0) so stray numbers don't leak
// into frontmatter.
function parseYearStarted(raw) {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(n)) return null;
  const currentYear = new Date().getUTCFullYear();
  if (n < 1950 || n > currentYear) return null;
  return n;
}

function buildFrontmatter(s, tier, featured) {
  const lines = ["---"];
  lines.push(`title: "${escYaml(s.brand_name || s.title)}"`);
  if (s.meta_title) lines.push(`meta_title: "${escYaml(s.meta_title)}"`);
  if (s.description) lines.push(`description: "${escYaml(s.description)}"`);
  if (s.image) lines.push(`image: "${s.image}"`);
  if (s.logo) lines.push(`logo: "${s.logo}"`);
  if (s.website) lines.push(`website: "${s.website}"`);
  lines.push(`email: "${s.email}"`);
  if (s.phone) lines.push(`phone: "${escYaml(s.phone)}"`);
  if (s.address) lines.push(`address: "${escYaml(s.address)}"`);
  lines.push("location:");
  s.location.forEach(l => lines.push(`  - ${l}`));
  lines.push("category:");
  s.category.forEach(c => lines.push(`  - ${c}`));
  if (featured) lines.push("featured: true");
  if (s.australia_wide) lines.push("australia_wide: true");
  if (s.international) lines.push("international: true");
  // Persist both states so an email relay can never infer consent from absence.
  lines.push(`accepts_agent_enquiries: ${s.accepts_agent_enquiries === true}`);
  if (Number.isInteger(s.year_started) && s.year_started > 0) {
    lines.push(`year_started: ${s.year_started}`);
  }
  lines.push(`tier: ${tier}`);
  const hasSocial = s.social?.facebook || s.social?.instagram || s.social?.pinterest;
  if (hasSocial) {
    lines.push("social:");
    if (s.social.facebook) lines.push(`  facebook: "${s.social.facebook}"`);
    if (s.social.instagram) lines.push(`  instagram: "${s.social.instagram}"`);
    if (s.social.pinterest) lines.push(`  pinterest: "${s.social.pinterest}"`);
  }
  lines.push("---");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Email templates
// ─────────────────────────────────────────────────────────────────────────────

function magicLinkEmailHtml(url, mode, env) {
  return emailShell(`
    <h1 style="font-size:24px;font-weight:700;color:#222;margin-bottom:8px;">
      ${mode === "edit" ? "Edit your listing" : "Create your listing"}
    </h1>
    <p style="font-size:16px;color:#666;line-height:1.6;margin-bottom:24px;">
      Click the button below to ${mode === "edit" ? "edit your listing" : "get started with your new listing"}.
    </p>
    <a href="${url}" style="display:inline-block;background:#ff385c;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">
      ${mode === "edit" ? "Edit My Listing" : "Create My Listing"}
    </a>
    <p style="font-size:13px;color:#999;margin-top:32px;line-height:1.5;">
      This link expires in 15 minutes. If you didn't request this, you can ignore this email.
    </p>
  `);
}

function adminNotificationHtml(s, adminToken, env) {
  const authUrl = `${env.WORKER_URL}/admin/auth?token=${adminToken}&id=${s.id}`;
  const isNew = !s.existing_slug;
  const flags = [s.australia_wide && "Australia Wide", s.international && "International"].filter(Boolean).join(", ");

  const bannerColor = isNew ? "#16a34a" : "#2563eb";
  const bannerText = isNew ? "NEW LISTING" : "LISTING UPDATE";

  return emailShell(`
    <div style="background:${bannerColor};color:#fff;padding:16px 24px;border-radius:8px;margin-bottom:24px;text-align:center;">
      <div style="font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;opacity:0.8;margin-bottom:4px;">${bannerText}</div>
      <div style="font-size:22px;font-weight:700;">${esc(s.title)}</div>
      <div style="font-size:14px;opacity:0.9;margin-top:4px;">${esc(s.location?.join(", ") || "")}</div>
    </div>

    <p style="font-size:14px;color:#999;margin-bottom:16px;">Submitted: ${s.submitted_at}</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 0;color:#666;width:140px;vertical-align:top;">Name</td><td style="padding:8px 0;color:#222;">${esc(s.title)}</td></tr>
      <tr><td style="padding:8px 0;color:#666;">Brand Name</td><td style="padding:8px 0;color:#222;">${esc(s.brand_name || "(same as name)")}</td></tr>
      <tr><td style="padding:8px 0;color:#666;">Email</td><td style="padding:8px 0;color:#222;">${esc(s.email)}</td></tr>
      <tr><td style="padding:8px 0;color:#666;">Website</td><td style="padding:8px 0;color:#222;">${s.website ? `<a href="${esc(s.website)}" style="color:#ff385c;">${esc(s.website)}</a>` : "---"}</td></tr>
      <tr><td style="padding:8px 0;color:#666;">Phone</td><td style="padding:8px 0;color:#222;">${esc(s.phone || "---")}</td></tr>
      <tr><td style="padding:8px 0;color:#666;">Address</td><td style="padding:8px 0;color:#222;">${esc(s.address || "---")}</td></tr>
      <tr><td style="padding:8px 0;color:#666;">Locations</td><td style="padding:8px 0;color:#222;">${esc(s.location?.join(", ") || "")}</td></tr>
      <tr><td style="padding:8px 0;color:#666;">Categories</td><td style="padding:8px 0;color:#222;">${esc(s.category?.join(", ") || "")}</td></tr>
      ${flags ? `<tr><td style="padding:8px 0;color:#666;">Travel</td><td style="padding:8px 0;color:#222;">${esc(flags)}</td></tr>` : ""}
      ${s.social?.instagram ? `<tr><td style="padding:8px 0;color:#666;">Instagram</td><td style="padding:8px 0;color:#222;">${esc(s.social.instagram)}</td></tr>` : ""}
      ${s.social?.facebook ? `<tr><td style="padding:8px 0;color:#666;">Facebook</td><td style="padding:8px 0;color:#222;">${esc(s.social.facebook)}</td></tr>` : ""}
      <tr><td style="padding:8px 0;color:#666;">Images</td><td style="padding:8px 0;color:#222;">${s.has_image_upload ? "Photo uploaded" : "No photo"}${s.has_logo_upload ? " · Logo uploaded" : ""}</td></tr>
      ${s.existing_slug ? `<tr><td style="padding:8px 0;color:#666;">Existing listing</td><td style="padding:8px 0;color:#222;"><a href="${env.SITE_URL}/directory/${s.existing_slug}/" style="color:#ff385c;">${env.SITE_URL}/directory/${s.existing_slug}/</a></td></tr>` : ""}
      ${s.existing_tier ? `<tr><td style="padding:8px 0;color:#666;">Current tier</td><td style="padding:8px 0;color:#222;">${esc(s.existing_tier)}</td></tr>` : ""}
      ${s.ai_status ? `<tr><td style="padding:8px 0;color:#666;">AI cleanup</td><td style="padding:8px 0;color:#222;">${esc(s.ai_status)}</td></tr>` : ""}
    </table>

    ${s.description ? `<div style="margin-top:16px;padding:12px 16px;background:#f7f7f7;border-radius:8px;"><p style="font-size:13px;font-weight:600;color:#666;margin-bottom:4px;">Description</p><p style="font-size:14px;color:#222;margin:0;">${esc(s.description)}</p></div>` : ""}

    ${s.bio ? `<div style="margin-top:12px;padding:12px 16px;background:#f7f7f7;border-radius:8px;"><p style="font-size:13px;font-weight:600;color:#666;margin-bottom:4px;">Bio (excerpt)</p><p style="font-size:14px;color:#222;margin:0;">${esc((s.bio || "").substring(0, 300))}${(s.bio || "").length > 300 ? "..." : ""}</p></div>` : ""}

    ${s.has_tier_evidence ? `
      <div style="margin-top:16px;padding:12px 16px;background:#fdf2f7;border:1px solid #92174d33;border-radius:8px;">
        <p style="font-size:13px;font-weight:600;color:#92174d;margin-bottom:8px;">Tier Upgrade Evidence Submitted</p>
        <ul style="font-size:13px;color:#666;margin:0;padding-left:16px;">
          ${s.tier_upgrade?.registration_year ? `<li>Year first registered: ${esc(s.tier_upgrade.registration_year)}</li>` : ""}
          ${s.tier_upgrade?.cert_iv ? `<li>Cert IV: ${esc(s.tier_upgrade.cert_iv)}</li>` : ""}
          ${s.tier_upgrade?.insurance ? `<li>PI insurance: ${esc(s.tier_upgrade.insurance)}</li>` : ""}
          ${s.tier_upgrade?.ceremony_count ? `<li>Ceremonies performed: ${esc(s.tier_upgrade.ceremony_count)}</li>` : ""}
          ${s.tier_upgrade?.sustainable_practice ? `<li>Sustainable practice: ${esc(s.tier_upgrade.sustainable_practice)}</li>` : ""}
          ${s.tier_upgrade?.industry_recognition ? `<li>Industry recognition: yes</li>` : ""}
          ${s.tier_upgrade?.professional_development ? `<li>Professional development: yes</li>` : ""}
          ${s.tier_upgrade?.couple_reviews_links ? `<li>Couple review links: provided</li>` : ""}
          ${s.tier_upgrade?.vendor_reviews_links ? `<li>Vendor review links: provided</li>` : ""}
        </ul>
        ${s.evidence_files?.length ? `
          <p style="font-size:13px;font-weight:600;color:#92174d;margin:12px 0 6px;">${s.evidence_files.length} file(s) attached</p>
          <ul style="font-size:13px;color:#666;margin:0;padding-left:16px;">
            ${s.evidence_files.map((f, i) => `
              <li style="margin-bottom:4px;">
                <a href="${env.WORKER_URL}/admin/image?id=${s.id}&type=evidence&index=${i}" style="color:#92174d;word-break:break-all;">${esc(f.name || `evidence-${i + 1}.${f.ext || ""}`)}</a>
                <span style="color:#999;font-size:11px;">(${esc(f.type || f.ext || "")})</span>
              </li>
            `).join("")}
          </ul>
          <p style="font-size:11px;color:#999;margin:8px 0 0;">File links require an active admin session — click "Review &amp; Approve" first to log in.</p>
        ` : ""}
      </div>
    ` : ""}

    <a href="${authUrl}" style="display:inline-block;background:#222;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;margin-top:24px;">
      Review &amp; Approve
    </a>
  `);
}

function celebrantApprovalHtml(s, notify, env) {
  const listingUrl = `${env.SITE_URL}/directory/${notify.slug}/`;
  const tierLabels = { registered: "Registered", endorsed: "Endorsed", luminary: "Luminary" };
  const tierLabel = tierLabels[notify.tier] || "Registered";

  const tierUpgradeInfo = {
    registered: `
      <h3 style="font-size:16px;font-weight:600;color:#222;margin-bottom:8px;">How to reach Endorsed</h3>
      <ul style="font-size:14px;color:#666;line-height:1.8;padding-left:20px;">
        <li>3+ years registered as a marriage celebrant</li>
        <li>Current professional indemnity insurance</li>
        <li>Professional development beyond OPD requirements</li>
        <li>6+ verified reviews from couples and 3+ from fellow wedding vendors</li>
        <li>100+ ceremonies performed</li>
      </ul>
    `,
    endorsed: `
      <h3 style="font-size:16px;font-weight:600;color:#222;margin-bottom:8px;">How to reach Luminary</h3>
      <ul style="font-size:14px;color:#666;line-height:1.8;padding-left:20px;">
        <li>7+ years registered as a marriage celebrant</li>
        <li>18+ verified reviews from couples</li>
        <li>9+ verified reviews from fellow wedding vendors</li>
        <li>Industry recognition (awards, media, speaking)</li>
        <li>Demonstrated contribution to the profession</li>
      </ul>
    `,
    luminary: `
      <p style="font-size:14px;color:#666;line-height:1.6;">
        You've reached the highest recognition we offer. Thank you for your contribution to the profession.
      </p>
    `,
  };

  return emailShell(`
    <h1 style="font-size:24px;font-weight:700;color:#222;margin-bottom:8px;">Congratulations — your listing is live!</h1>
    <p style="font-size:16px;color:#666;line-height:1.6;margin-bottom:24px;">
      Great news, <strong>${esc(s.title)}</strong>! Your listing on Australian Wedding Celebrants has been approved and is now live. Welcome to the directory — we're glad to have you.
    </p>
    <a href="${listingUrl}" style="display:inline-block;background:#ff385c;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">
      View Your Listing
    </a>

    <hr style="border:none;border-top:1px solid #eee;margin:32px 0;" />

    <h2 style="font-size:18px;font-weight:700;color:#222;margin-bottom:8px;">Add your badge to your website</h2>
    <p style="font-size:14px;color:#666;line-height:1.6;margin-bottom:16px;">
      We've created an embed badge for your website that links back to your profile. Adding this badge to your website helps couples find you through our directory and strengthens your listing's visibility in search engines.
    </p>
    <p style="font-size:14px;color:#666;line-height:1.6;margin-bottom:16px;">
      To get your badge code, visit your profile and click <strong>"Show embed badge for your website"</strong> at the bottom of the page. Copy the code and paste it into your website — your footer, about page, or sidebar all work great.
    </p>
    <a href="${listingUrl}" style="display:inline-block;background:#222;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
      Get Your Badge Code
    </a>

    <hr style="border:none;border-top:1px solid #eee;margin:32px 0;" />

    <h2 style="font-size:18px;font-weight:700;color:#222;margin-bottom:4px;">Your tier: ${tierLabel}</h2>
    <p style="font-size:14px;color:#666;line-height:1.6;margin-bottom:16px;">
      Our tier system recognises professional standards, not popularity. Every tier is earned through documented evidence — not bought, not voted on. If you meet the criteria, the recognition is yours.
    </p>
    ${tierUpgradeInfo[notify.tier] || tierUpgradeInfo.registered}
    <p style="font-size:14px;color:#666;line-height:1.6;margin-top:16px;">
      Ready to submit documentation for your next tier? <a href="${env.SITE_URL}/contact/" style="color:#ff385c;">Get in touch</a>.
    </p>
  `);
}

function celebrantRejectionHtml(s, reason, env) {
  const joinUrl = `${env.WORKER_URL}/login`;

  return emailShell(`
    <h1 style="font-size:24px;font-weight:700;color:#222;margin-bottom:8px;">About your listing submission</h1>
    <p style="font-size:16px;color:#666;line-height:1.6;margin-bottom:24px;">
      Hi <strong>${esc(s.title)}</strong>, thanks for submitting your listing to Australian Wedding Celebrants. Unfortunately, we weren't able to approve your submission at this time.
    </p>

    ${reason ? `
      <div style="background:#f7f7f7;border-left:4px solid #ff385c;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:24px;">
        <p style="font-size:14px;font-weight:600;color:#222;margin-bottom:8px;">Reason:</p>
        <p style="font-size:14px;color:#444;line-height:1.6;margin:0;">${esc(reason).replace(/\n/g, "<br/>")}</p>
      </div>
    ` : ""}

    <p style="font-size:16px;color:#666;line-height:1.6;margin-bottom:24px;">
      We'd love to have you in the directory. You're welcome to submit a new listing addressing the feedback above — we'll be happy to review it again.
    </p>

    <a href="${joinUrl}" style="display:inline-block;background:#ff385c;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">
      Submit Again
    </a>

    <hr style="border:none;border-top:1px solid #eee;margin:32px 0;" />

    <p style="font-size:14px;color:#666;line-height:1.6;">
      If you have any questions, feel free to <a href="${env.SITE_URL}/contact/" style="color:#ff385c;">get in touch</a> — we're always happy to help.
    </p>
  `);
}

function emailShell(body) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;">
    ${body}
    <hr style="border:none;border-top:1px solid #eee;margin:32px 0;" />
    <p style="font-size:12px;color:#bbb;">Australian Wedding Celebrants · australianweddingcelebrants.com.au</p>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML page templates
// ─────────────────────────────────────────────────────────────────────────────

function pageShell(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${esc(title)} — Australian Wedding Celebrants</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif;background:#fafafa;color:#222;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 20px}
    .card{background:#fff;border-radius:20px;padding:40px;max-width:640px;width:100%;box-shadow:rgba(0,0,0,.02) 0 0 0 1px,rgba(0,0,0,.04) 0 2px 6px,rgba(0,0,0,.1) 0 4px 8px}
    h1{font-size:24px;font-weight:700;letter-spacing:-.44px;margin-bottom:12px}
    h2{font-size:18px;font-weight:600;margin-bottom:8px}
    h3{font-size:16px;font-weight:600;margin-bottom:8px}
    p{color:#666;line-height:1.6;font-size:15px;margin-bottom:12px}
    .label{display:block;font-size:13px;font-weight:500;color:#222;margin-bottom:4px}
    .input,.textarea{width:100%;border:1px solid #e0e0e0;border-radius:8px;padding:10px 14px;font-size:14px;font-family:inherit;transition:border-color .2s}
    .input:focus,.textarea:focus{outline:none;border-color:#222}
    .textarea{resize:vertical}
    .space-y-4>*+*{margin-top:16px}
    .space-y-6>*+*{margin-top:24px}
    .mt-2{margin-top:8px}.mt-4{margin-top:16px}.mt-6{margin-top:24px}.mb-4{margin-bottom:16px}
    .w-full{width:100%}
    .btn{display:inline-block;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;border:none;cursor:pointer;font-family:inherit}
    .btn-primary{background:#ff385c;color:#fff}
    .btn-dark{background:#222;color:#fff}
    .btn-sm{padding:8px 16px;font-size:13px}
    .hint{font-size:13px;color:#999}
    .text-light{color:#6a6a6a}.text-sm{font-size:13px}
    .alert{padding:12px 16px;border-radius:8px;font-size:14px;margin-bottom:16px}
    .alert-error{background:#fef2f2;border:1px solid #fecaca;color:#dc2626}
    .info-box{background:#f7f7f7;border-radius:12px;padding:20px;border:1px solid #e0e0e0}
    .info-box h3{margin-bottom:4px;color:#222}.info-box p{font-size:13px;color:#666;margin:0}
    fieldset{border:1px solid #e0e0e0;border-radius:12px;padding:20px}
    legend{font-size:15px;font-weight:600;padding:0 8px}
    .checkbox-row{display:flex;flex-wrap:wrap;gap:16px;align-items:center}
    .checkbox-row label{display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer}
    .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    @media(max-width:500px){.grid-2{grid-template-columns:1fr}}
    .card-item{padding:16px;border:1px solid #e0e0e0;border-radius:12px;margin-bottom:12px}
    select{width:100%;border:1px solid #e0e0e0;border-radius:8px;padding:10px 14px;font-size:14px;font-family:inherit;background:#fff}
    details .chevron{transition:transform .2s}details[open] .chevron{transform:rotate(90deg)}
    details summary::-webkit-details-marker{display:none}
  </style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

function adminPageShell(title, body, activeNav) {
  const navItems = [
    { id: "dashboard", label: "Dashboard", href: "/admin" },
    { id: "review", label: "Review", href: "/admin/review" },
    { id: "listings", label: "Listings", href: "/admin/listings" },
    { id: "submissions", label: "Submissions", href: "/admin/submissions" },
    { id: "email", label: "Email All", href: "/admin/email" },
  ];

  const navHtml = navItems.map(n => `
    <a href="${n.href}" style="padding:8px 16px;border-radius:6px;font-size:13px;font-weight:${activeNav === n.id ? "600" : "400"};color:${activeNav === n.id ? "#fff" : "#666"};background:${activeNav === n.id ? "#222" : "transparent"};text-decoration:none;transition:all .2s;">${n.label}</a>
  `).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${esc(title)} — Admin — AWC</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif;background:#fafafa;color:#222;min-height:100vh;padding:20px}
    .admin-wrap{max-width:960px;margin:0 auto}
    .admin-nav{background:#fff;border-radius:12px;padding:8px;margin-bottom:20px;display:flex;gap:4px;flex-wrap:wrap;box-shadow:rgba(0,0,0,.02) 0 0 0 1px,rgba(0,0,0,.04) 0 2px 6px}
    .admin-card{background:#fff;border-radius:20px;padding:32px;box-shadow:rgba(0,0,0,.02) 0 0 0 1px,rgba(0,0,0,.04) 0 2px 6px,rgba(0,0,0,.1) 0 4px 8px}
    h1{font-size:24px;font-weight:700;letter-spacing:-.44px;margin-bottom:12px}
    h2{font-size:18px;font-weight:600;margin-bottom:8px}
    h3{font-size:16px;font-weight:600;margin-bottom:8px}
    p{color:#666;line-height:1.6;font-size:15px;margin-bottom:12px}
    .label{display:block;font-size:13px;font-weight:500;color:#222;margin-bottom:4px}
    .input,.textarea{width:100%;border:1px solid #e0e0e0;border-radius:8px;padding:10px 14px;font-size:14px;font-family:inherit;transition:border-color .2s}
    .input:focus,.textarea:focus{outline:none;border-color:#222}
    .textarea{resize:vertical}
    .space-y-4>*+*{margin-top:16px}
    .space-y-6>*+*{margin-top:24px}
    .mt-2{margin-top:8px}.mt-4{margin-top:16px}.mt-6{margin-top:24px}.mb-4{margin-bottom:16px}
    .w-full{width:100%}
    .btn{display:inline-block;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;border:none;cursor:pointer;font-family:inherit}
    .btn-primary{background:#ff385c;color:#fff}
    .btn-dark{background:#222;color:#fff}
    .btn-sm{padding:8px 16px;font-size:13px}
    .hint{font-size:13px;color:#999}
    .text-light{color:#6a6a6a}.text-sm{font-size:13px}
    .alert{padding:12px 16px;border-radius:8px;font-size:14px;margin-bottom:16px}
    .alert-error{background:#fef2f2;border:1px solid #fecaca;color:#dc2626}
    .info-box{background:#f7f7f7;border-radius:12px;padding:20px;border:1px solid #e0e0e0}
    .info-box h3{margin-bottom:4px;color:#222}.info-box p{font-size:13px;color:#666;margin:0}
    fieldset{border:1px solid #e0e0e0;border-radius:12px;padding:20px}
    legend{font-size:15px;font-weight:600;padding:0 8px}
    .checkbox-row{display:flex;flex-wrap:wrap;gap:16px;align-items:center}
    .checkbox-row label{display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer}
    .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    @media(max-width:600px){.grid-2{grid-template-columns:1fr}}
    .card-item{padding:16px;border:1px solid #e0e0e0;border-radius:12px;margin-bottom:12px}
    select{width:100%;border:1px solid #e0e0e0;border-radius:8px;padding:10px 14px;font-size:14px;font-family:inherit;background:#fff}
    details .chevron{transition:transform .2s}details[open] .chevron{transform:rotate(90deg)}
    details summary::-webkit-details-marker{display:none}
    .stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px}
    @media(max-width:600px){.stats-grid{grid-template-columns:1fr}}
    .stat-card{background:#f7f7f7;border-radius:12px;padding:20px;text-align:center;border:1px solid #e0e0e0}
    .stat-number{font-size:32px;font-weight:700;color:#222}
    .stat-label{font-size:13px;color:#666;margin-top:4px}
    .status-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;margin-left:6px}
    .status-pending_ai{background:#dbeafe;color:#1d4ed8}
    .status-pending_review{background:#fef3c7;color:#92400e}
    .status-approved{background:#d1fae5;color:#065f46}
    .tier-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;margin-left:6px}
    .tier-luminary{background:#f5f0fa;color:#460479}
    .tier-endorsed{background:#fdf2f7;color:#92174d}
    .tier-registered{background:#f7f7f7;color:#6a6a6a}
  </style>
</head>
<body>
  <div class="admin-wrap">
    <div class="admin-nav">${navHtml}</div>
    <div class="admin-card">${body}</div>
  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Form HTML — Celebrant create/edit form
// ─────────────────────────────────────────────────────────────────────────────

function formHtml(session, existing, env) {
  const e = existing || {};
  const body = e._body || "";
  const locations = (e.location || []).join(", ");
  const categories = e.category || ["Celebrant"];
  const allCategories = ["Celebrant", "MC", "DJ", "Elopement Planner"];

  return `
    <h1>${existing ? "Edit Your Listing" : "Create Your Listing"}</h1>
    <p>${existing ? "Update your listing details below." : "Fill in your details to create your free listing."}</p>
    <form method="POST" action="/submit" enctype="multipart/form-data" class="space-y-6 mt-6">

      <fieldset class="space-y-4">
        <legend>About You</legend>
        <div>
          <label class="label" for="title">Your name *</label>
          <input class="input" type="text" id="title" name="title" required value="${escAttr(e.title || "")}" placeholder="Jane Smith" />
        </div>
        <div>
          <label class="label" for="brand_name">Business / brand name</label>
          <input class="input" type="text" id="brand_name" name="brand_name" value="${escAttr(e.title || "")}" placeholder="e.g. Celebrant Jane or leave blank if same as your name" />
          <p class="hint">This is what appears as your listing title. Leave blank to use your name.</p>
        </div>
        <div>
          <label class="label" for="description">Short description</label>
          <textarea class="textarea" id="description" name="description" rows="2" placeholder="1-2 sentences about you (we'll help polish this)">${esc(e.description || "")}</textarea>
        </div>
        <div>
          <label class="label" for="bio">Full bio — use <a href="https://daringfireball.net/projects/markdown/basics" target="_blank" rel="noopener" style="color:#ff385c;">Markdown formatting</a></label>
          <textarea class="textarea" id="bio" name="bio" rows="8" placeholder="Tell couples about yourself, your style, your experience... Use **bold**, *italic*, and line breaks for formatting.">${esc(body)}</textarea>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
            <button type="button" class="btn btn-sm ai-edit-btn" data-type="better" style="border:1px solid #e0e0e0;background:#fff;">Make it better with AI</button>
            <button type="button" class="btn btn-sm ai-edit-btn" data-type="longer" style="border:1px solid #e0e0e0;background:#fff;">Make it longer with AI</button>
            <button type="button" class="btn btn-sm ai-edit-btn" data-type="shorter" style="border:1px solid #e0e0e0;background:#fff;">Make it shorter with AI</button>
            <button type="button" class="btn btn-sm ai-edit-btn" data-type="helpful" style="border:1px solid #e0e0e0;background:#fff;">Make it more helpful with AI</button>
          </div>
          <div id="ai-status" style="display:none;margin-top:8px;" class="text-sm"></div>
          <div id="ai-cost" style="display:none;margin-top:6px;padding:8px 12px;background:#f7f7f7;border-radius:8px;font-size:12px;color:#666;"></div>
        </div>
        <div>
          <label class="label" for="year_started">Year you started as a celebrant</label>
          <input class="input" type="number" id="year_started" name="year_started" min="1950" max="${new Date().getUTCFullYear()}" value="${escAttr(e.year_started || "")}" placeholder="e.g. 2015" />
          <p class="hint">Used to show a "Class of {year}" 🎓 award on your Trophy Shelf.</p>
        </div>
      </fieldset>

      <fieldset class="space-y-4">
        <legend>Contact</legend>
        <div>
          <label class="label">Email</label>
          <input class="input" type="email" value="${escAttr(session.email)}" disabled style="background:#f7f7f7;color:#999" />
          <input type="hidden" name="email" value="${escAttr(session.email)}" />
        </div>
        <div>
          <label class="label" for="website">Website</label>
          <input class="input" type="url" id="website" name="website" value="${escAttr(e.website || "")}" placeholder="https://www.example.com" />
        </div>
        <div class="grid-2">
          <div>
            <label class="label" for="phone">Phone</label>
            <input class="input" type="tel" id="phone" name="phone" value="${escAttr(e.phone || "")}" placeholder="0400 000 000" />
          </div>
          <div>
            <label class="label" for="address">Address</label>
            <input class="input" type="text" id="address" name="address" value="${escAttr(e.address || "")}" placeholder="Gold Coast, QLD" />
          </div>
        </div>
      </fieldset>

      <fieldset class="space-y-4">
        <legend>Images</legend>
        <div>
          <label class="label" for="image_file">Profile photo</label>
          ${typeof e.image === 'string' && e.image ? `<div style="margin-bottom:8px"><img src="${resolveImageUrl(e.image, env)}" alt="Current photo" style="max-width:200px;max-height:200px;border-radius:8px;border:1px solid #e0e0e0" /></div>` : ""}
          <input class="input" type="file" id="image_file" name="image_file" accept="image/*" style="padding:8px" />
          ${typeof e.image === 'string' && e.image ? `<input type="hidden" name="existing_image" value="${escAttr(e.image)}" /><p class="hint">Upload a new photo to replace your current one, or leave empty to keep it.</p>` : `<p class="hint">Upload a professional photo of you in action (JPG, PNG, WebP).</p>`}
        </div>
        <div>
          <label class="label" for="logo_file">Logo (optional)</label>
          ${typeof e.logo === 'string' && e.logo ? `<div style="margin-bottom:8px"><img src="${resolveImageUrl(e.logo, env)}" alt="Current logo" style="max-width:160px;max-height:60px;object-fit:contain" /></div>` : ""}
          <input class="input" type="file" id="logo_file" name="logo_file" accept="image/*" style="padding:8px" />
          ${typeof e.logo === 'string' && e.logo ? `<input type="hidden" name="existing_logo" value="${escAttr(e.logo)}" /><p class="hint">Upload a new logo to replace your current one, or leave empty to keep it.</p>` : `<p class="hint">Your business logo if you have one (PNG, SVG preferred).</p>`}
        </div>
      </fieldset>

      <fieldset class="space-y-4">
        <legend>Location &amp; Services</legend>
        <div>
          <label class="label" for="location">Service locations *</label>
          <input class="input" type="text" id="location" name="location" required value="${escAttr(locations)}" placeholder="Melbourne, Yarra Valley, Mornington Peninsula" />
          <p class="hint">Comma-separated list of areas you service.</p>
        </div>
        <div>
          <label class="label mb-4">Services *</label>
          <div class="checkbox-row">
            ${allCategories.map(cat => `
              <label><input type="checkbox" name="category" value="${cat}" ${categories.includes(cat) ? "checked" : ""} /> ${cat}</label>
            `).join("")}
          </div>
        </div>
        <div class="checkbox-row mt-4">
          <label><input type="checkbox" name="australia_wide" ${e.australia_wide ? "checked" : ""} /> I travel Australia wide</label>
          <label><input type="checkbox" name="international" ${e.international ? "checked" : ""} /> I do destination weddings internationally</label>
        </div>

        <div class="mt-4">
          <input type="hidden" name="opt_enquiries_present" value="1" />
          <label style="display: block;">
            <input type="checkbox" name="accepts_agent_enquiries" ${e.accepts_agent_enquiries === true ? "checked" : ""} />
            <strong>Let AI agents relay wedding enquiries to my email address</strong>
          </label>
          <p class="text-light" style="font-size: 13px; margin-top: 6px; max-width: 60ch;">
            Check this box to opt in. We run a free pass-through so AI assistants helping couples plan their wedding can email you qualified enquiries (date, location, ceremony notes). You reply directly to the couple — we're not in the loop. An unchecked or missing setting blocks the relay.
          </p>
        </div>
      </fieldset>

      <fieldset class="space-y-4">
        <legend>Social Media</legend>
        <div>
          <label class="label" for="instagram">Instagram</label>
          <input class="input" type="url" id="instagram" name="instagram" value="${escAttr(e.social?.instagram || "")}" placeholder="https://instagram.com/you" />
        </div>
        <div>
          <label class="label" for="facebook">Facebook</label>
          <input class="input" type="url" id="facebook" name="facebook" value="${escAttr(e.social?.facebook || "")}" placeholder="https://facebook.com/you" />
        </div>
        <div>
          <label class="label" for="pinterest">Pinterest</label>
          <input class="input" type="url" id="pinterest" name="pinterest" value="${escAttr(e.social?.pinterest || "")}" placeholder="https://pinterest.com/you" />
        </div>
      </fieldset>

      <!-- Tier upgrade evidence -->
      <details class="tier-upgrade" style="border:1px solid #e0e0e0;border-radius:12px;padding:0;overflow:hidden;">
        <summary style="padding:16px 20px;cursor:pointer;font-size:15px;font-weight:600;color:#222;list-style:none;display:flex;align-items:center;gap:8px;">
          <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Apply for a tier upgrade
        </summary>
        <div style="padding:0 20px 20px;" class="space-y-4">
          <p class="hint">Provide evidence for the tier you're applying for. Endorsed builds on the Registered baseline; Luminary builds on Endorsed. Only complete the sections that apply. <a href="${env.SITE_URL}/tiers/" target="_blank" style="color:#ff385c;">Learn about our tiers</a></p>

          <!-- Baseline (Registered) -->
          <div style="padding:12px 16px;border-radius:8px;background:#f7f7f7;border:1px solid #e0e0e0;">
            <p style="font-size:13px;font-weight:600;color:#222;margin-bottom:4px;">Baseline — Registered</p>
            <p class="hint" style="margin:0;">Commonwealth authorised marriage celebrant under the Marriage Act 1961, Certificate IV in Celebrancy (or equivalent), and a complete profile.</p>
          </div>

          <div>
            <label class="label">Certificate IV in Celebrancy or equivalent qualification</label>
            <select class="input" name="cert_iv">
              <option value="">Select...</option>
              <option value="yes">Yes — I hold a Certificate IV in Celebrancy</option>
              <option value="equivalent">Yes — I hold an equivalent qualification</option>
              <option value="no">No</option>
            </select>
            <p class="hint">Required for the Registered baseline. Upload your certificate below.</p>
          </div>

          <!-- Endorsed -->
          <div style="padding:12px 16px;border-radius:8px;background:#fdf2f7;border:1px solid #92174d33;margin-top:16px;">
            <p style="font-size:13px;font-weight:600;color:#92174d;margin-bottom:4px;">Endorsed requirements</p>
            <p class="hint" style="margin:0;">Meets the Registered baseline, plus: 3+ years registered, current PI insurance, professional development beyond OPD, 6+ verified couple reviews, 3+ verified vendor reviews, and 100+ ceremonies performed.</p>
          </div>

          <div>
            <label class="label">Year you were first registered as a marriage celebrant</label>
            <input class="input" type="number" name="registration_year" min="1960" max="${new Date().getUTCFullYear()}" placeholder="e.g. 2019" />
            <p class="hint">3+ years ago for Endorsed, 7+ years ago for Luminary.</p>
          </div>

          <div>
            <label class="label">Current professional indemnity insurance</label>
            <select class="input" name="insurance">
              <option value="">Select...</option>
              <option value="yes">Yes — I have a current certificate of currency</option>
              <option value="no">No</option>
            </select>
            <p class="hint">Upload your certificate of currency below.</p>
          </div>

          <div>
            <label class="label">Professional development beyond legislative OPD</label>
            <textarea class="textarea" name="professional_development" rows="3" placeholder="Training, courses, workshops, conferences, or certifications beyond the minimum 5 hours of OPD required by the Attorney-General's Department"></textarea>
          </div>

          <div>
            <label class="label">Approximate number of ceremonies performed</label>
            <input class="input" type="number" name="ceremony_count" min="0" placeholder="e.g. 150" />
            <p class="hint">100+ required for Endorsed. A statutory declaration is helpful — upload below.</p>
          </div>

          <div>
            <label class="label">Verified reviews from couples you have married</label>
            <textarea class="textarea" name="couple_reviews_links" rows="3" placeholder="Paste one URL per line — Google, Easy Weddings, ABIA, etc."></textarea>
            <p class="hint">6+ for Endorsed, 18+ for Luminary.</p>
          </div>

          <div>
            <label class="label">Verified reviews from fellow wedding vendors</label>
            <textarea class="textarea" name="vendor_reviews_links" rows="3" placeholder="Paste one URL per line — photographers, planners, venues, etc."></textarea>
            <p class="hint">3+ for Endorsed, 9+ for Luminary.</p>
          </div>

          <!-- Luminary additional -->
          <div style="padding:12px 16px;border-radius:8px;background:#f5f0fa;border:1px solid #46047933;margin-top:16px;">
            <p style="font-size:13px;font-weight:600;color:#460479;margin-bottom:4px;">Luminary additional requirements</p>
            <p class="hint" style="margin:0;">Meets the Endorsed standard, plus: 7+ years operating a sustainable celebrancy practice as a meaningful part of your livelihood, and industry recognition (awards, media features, published work, or conference speaking).</p>
          </div>

          <div>
            <label class="label">Sustainable celebrancy practice</label>
            <select class="input" name="sustainable_practice">
              <option value="">Select...</option>
              <option value="yes">Yes — celebrancy is a meaningful part of my livelihood</option>
              <option value="no">No</option>
            </select>
            <p class="hint">Required for Luminary — confirms 7+ years of sustained, professional practice rather than a side project.</p>
          </div>

          <div>
            <label class="label">Industry recognition</label>
            <textarea class="textarea" name="industry_recognition" rows="3" placeholder="Awards (ABIA, Easy Weddings, etc.), media features, published work, podcasts, or conference speaking"></textarea>
            <p class="hint">Required for Luminary.</p>
          </div>

          <div>
            <label class="label">Upload supporting documents</label>
            <input class="input" type="file" name="evidence_files" multiple accept=".pdf,.jpg,.jpeg,.png,.heif,.doc,.docx" style="padding:8px" />
            <p class="hint">Certificate IV, insurance certificate of currency, OPD records, statutory declarations of ceremonies performed, screenshots of reviews, evidence of awards. Up to 10 files, 20 MB each.</p>
          </div>
        </div>
      </details>

      <button type="submit" id="submit-btn" class="btn btn-primary w-full">${existing ? "Update Listing" : "Submit Listing"}</button>
      <p class="hint" style="text-align:center;">By submitting, you confirm you are a Commonwealth authorised marriage celebrant.</p>
    </form>

    <script>
      // Prevent double-submit
      (function() {
        const form = document.querySelector('form[action="/submit"]');
        const btn = document.getElementById('submit-btn');
        if (form && btn) {
          form.addEventListener('submit', function() {
            btn.disabled = true;
            btn.textContent = 'Submitting… please wait';
            btn.style.opacity = '0.7';
            btn.style.cursor = 'not-allowed';
          });
        }
      })();
    </script>

    <script>
      let totalAiCost = 0;

      document.querySelectorAll('.ai-edit-btn').forEach(btn => {
        btn.addEventListener('click', async function() {
          const editType = this.dataset.type;
          const bio = document.getElementById('bio').value;
          if (!bio.trim()) { alert('Write some bio text first, then use AI to improve it.'); return; }

          // Gather form data
          const formData = {
            bio,
            edit_type: editType,
            title: document.getElementById('title')?.value || '',
            brand_name: document.getElementById('brand_name')?.value || '',
            description: document.getElementById('description')?.value || '',
            website: document.getElementById('website')?.value || '',
            location: document.getElementById('location')?.value || '',
            category: [...document.querySelectorAll('input[name="category"]:checked')].map(c => c.value),
          };

          // Disable all AI buttons
          document.querySelectorAll('.ai-edit-btn').forEach(b => { b.disabled = true; });
          this.textContent = 'Thinking...';
          const statusEl = document.getElementById('ai-status');
          statusEl.style.display = 'block';
          statusEl.style.color = '#666';
          statusEl.textContent = 'AI is rewriting your bio...';

          try {
            const res = await fetch('/ai-edit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(formData),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            document.getElementById('bio').value = data.bio;
            totalAiCost = data.total_cost || 0;

            statusEl.style.color = '#16a34a';
            statusEl.textContent = 'Done! Review the updated bio above.';

            if (totalAiCost > 0) {
              const costEl = document.getElementById('ai-cost');
              costEl.style.display = 'block';
              costEl.innerHTML = 'AI usage cost: <strong>$' + totalAiCost.toFixed(4) + '</strong> — Help cover costs via PayID: <strong>pay@withers.co</strong>';
            }
          } catch (err) {
            statusEl.style.color = '#dc2626';
            statusEl.textContent = 'AI edit failed: ' + err.message;
          }

          // Re-enable buttons
          document.querySelectorAll('.ai-edit-btn').forEach(b => { b.disabled = false; });
          this.textContent = {better:'Make it better with AI',longer:'Make it longer with AI',shorter:'Make it shorter with AI',helpful:'Make it more helpful with AI'}[editType];
        });
      });
    </script>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin Review HTML
// ─────────────────────────────────────────────────────────────────────────────

function adminReviewHtml(s, env) {
  const isNew = !s.existing_slug;

  // Image previews
  let imagePreviewHtml = "";
  if (s.has_image_upload) {
    imagePreviewHtml += `<div style="margin-bottom:8px;"><p class="text-sm text-light" style="margin-bottom:4px;">Uploaded photo:</p><img src="/admin/image?id=${s.id}&type=image" alt="Uploaded photo" style="max-width:300px;border-radius:8px;border:1px solid #e0e0e0" /></div>`;
  } else if (s.image) {
    imagePreviewHtml += `<div style="margin-bottom:8px;"><p class="text-sm text-light" style="margin-bottom:4px;">Existing photo:</p><img src="${resolveImageUrl(s.image, env)}" alt="Current photo" style="max-width:300px;border-radius:8px;border:1px solid #e0e0e0" /></div>`;
  }
  if (s.has_logo_upload) {
    imagePreviewHtml += `<div style="margin-bottom:8px;"><p class="text-sm text-light" style="margin-bottom:4px;">Uploaded logo:</p><img src="/admin/image?id=${s.id}&type=logo" alt="Uploaded logo" style="max-width:200px;max-height:80px;object-fit:contain" /></div>`;
  } else if (s.logo) {
    imagePreviewHtml += `<div style="margin-bottom:8px;"><p class="text-sm text-light" style="margin-bottom:4px;">Existing logo:</p><img src="${resolveImageUrl(s.logo, env)}" alt="Current logo" style="max-width:200px;max-height:80px;object-fit:contain" /></div>`;
  }

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h1 style="margin:0;">Review: ${esc(s.title)}</h1>
      <span class="status-badge ${isNew ? 'status-pending_ai' : 'status-approved'}" style="font-size:13px;padding:4px 12px;">${isNew ? "New Listing" : "Update"}</span>
    </div>
    <p class="text-sm text-light">Submitted ${formatDate(s.submitted_at)}</p>

    ${imagePreviewHtml ? `<div class="info-box mb-4">${imagePreviewHtml}</div>` : ""}

    <form method="POST" action="/admin/approve" class="space-y-6 mt-6">
      <input type="hidden" name="id" value="${s.id}" />

      <fieldset class="space-y-4">
        <legend>Listing (editable)</legend>
        <div>
          <label class="label">Title / Brand Name</label>
          <input class="input" name="title" value="${escAttr(s.brand_name || s.title)}" />
        </div>
        <div>
          <label class="label">SEO Meta Title</label>
          <input class="input" name="meta_title" value="${escAttr(s.meta_title || "")}" />
        </div>
        <div>
          <label class="label">Description</label>
          <textarea class="textarea" name="description" rows="3">${esc(s.description || "")}</textarea>
        </div>
        <div>
          <label class="label">Bio (markdown)</label>
          <textarea class="textarea" name="bio" rows="8">${esc(s.bio || "")}</textarea>
        </div>
      </fieldset>

      <fieldset class="space-y-4">
        <legend>Admin Settings</legend>
        <div class="grid-2">
          <div>
            <label class="label">Tier</label>
            <select name="tier">
              <option value="registered" ${(!s.existing_tier || s.existing_tier === "registered") ? "selected" : ""}>Registered</option>
              <option value="endorsed" ${s.existing_tier === "endorsed" ? "selected" : ""}>Endorsed</option>
              <option value="luminary" ${s.existing_tier === "luminary" ? "selected" : ""}>Luminary</option>
            </select>
          </div>
          <div>
            <label class="label" style="margin-bottom:10px">Featured</label>
            <label style="display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer;">
              <input type="checkbox" name="featured" ${s.existing_featured ? "checked" : ""} /> Feature this listing
            </label>
          </div>
        </div>
      </fieldset>

      <div class="info-box">
        <h3>Submission details</h3>
        <p><strong>Name:</strong> ${esc(s.title)}</p>
        <p><strong>Brand name:</strong> ${esc(s.brand_name || "(same as name)")}</p>
        <p><strong>Email:</strong> ${esc(s.email)}</p>
        <p><strong>Website:</strong> ${s.website ? `<a href="${esc(s.website)}" target="_blank" style="color:#ff385c;">${esc(s.website)}</a>` : "---"}</p>
        <p><strong>Phone:</strong> ${esc(s.phone || "---")}</p>
        <p><strong>Address:</strong> ${esc(s.address || "---")}</p>
        <p><strong>Locations:</strong> ${esc(s.location?.join(", ") || "")}</p>
        <p><strong>Categories:</strong> ${esc(s.category?.join(", ") || "")}</p>
        ${s.australia_wide ? "<p><strong>Travels:</strong> Australia Wide</p>" : ""}
        ${s.international ? "<p><strong>Destination:</strong> International</p>" : ""}
        ${s.social?.instagram ? `<p><strong>Instagram:</strong> <a href="${esc(s.social.instagram)}" target="_blank" style="color:#ff385c;">${esc(s.social.instagram)}</a></p>` : ""}
        ${s.social?.facebook ? `<p><strong>Facebook:</strong> <a href="${esc(s.social.facebook)}" target="_blank" style="color:#ff385c;">${esc(s.social.facebook)}</a></p>` : ""}
        ${s.social?.pinterest ? `<p><strong>Pinterest:</strong> <a href="${esc(s.social.pinterest)}" target="_blank" style="color:#ff385c;">${esc(s.social.pinterest)}</a></p>` : ""}
        ${s.existing_slug ? `<p><strong>Existing listing:</strong> <a href="${env.SITE_URL}/directory/${s.existing_slug}/" target="_blank" style="color:#ff385c;">${env.SITE_URL}/directory/${s.existing_slug}/</a></p>` : ""}
        ${s.ai_status ? `<p><strong>AI cleanup:</strong> ${esc(s.ai_status)}</p>` : ""}
      </div>

      ${s.has_tier_evidence ? `
        <div class="info-box mt-4" style="border-color:#92174d33;background:#fdf2f7;">
          <h3 style="color:#92174d;">Tier Upgrade Evidence</h3>
          ${s.tier_upgrade?.registration_year ? `<p><strong>Year first registered:</strong> ${esc(s.tier_upgrade.registration_year)}</p>` : ""}
          ${s.tier_upgrade?.cert_iv ? `<p><strong>Certificate IV:</strong> ${esc(s.tier_upgrade.cert_iv)}</p>` : ""}
          ${s.tier_upgrade?.insurance ? `<p><strong>PI Insurance:</strong> ${esc(s.tier_upgrade.insurance)}</p>` : ""}
          ${s.tier_upgrade?.professional_development ? `<p><strong>Professional development beyond OPD:</strong><br/>${esc(s.tier_upgrade.professional_development).replace(/\n/g, "<br/>")}</p>` : ""}
          ${s.tier_upgrade?.ceremony_count ? `<p><strong>Ceremonies performed:</strong> ${esc(s.tier_upgrade.ceremony_count)}</p>` : ""}
          ${s.tier_upgrade?.couple_reviews_links ? `<p><strong>Couple review links:</strong><br/>${linkifyLines(s.tier_upgrade.couple_reviews_links)}</p>` : ""}
          ${s.tier_upgrade?.vendor_reviews_links ? `<p><strong>Vendor review links:</strong><br/>${linkifyLines(s.tier_upgrade.vendor_reviews_links)}</p>` : ""}
          ${s.tier_upgrade?.sustainable_practice ? `<p><strong>Sustainable practice (Luminary):</strong> ${esc(s.tier_upgrade.sustainable_practice)}</p>` : ""}
          ${s.tier_upgrade?.industry_recognition ? `<p><strong>Industry recognition (Luminary):</strong><br/>${esc(s.tier_upgrade.industry_recognition).replace(/\n/g, "<br/>")}</p>` : ""}
        </div>
      ` : ""}

      ${s.evidence_files?.length ? `
        <div class="info-box mt-4" style="border-color:#92174d33;">
          <h3 style="color:#92174d;">Uploaded Evidence Files (${s.evidence_files.length})</h3>
          <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px;">
            ${s.evidence_files.map((f, i) => {
              const viewUrl = `/admin/image?id=${s.id}&type=evidence&index=${i}`;
              const dlUrl = `${viewUrl}&download=1`;
              const isImage = (f.type || "").startsWith("image/");
              return `
                <li style="display:flex;gap:12px;align-items:flex-start;padding:10px;background:#fff;border:1px solid #e0e0e0;border-radius:8px;">
                  ${isImage
                    ? `<a href="${viewUrl}" target="_blank"><img src="${viewUrl}" alt="${escAttr(f.name)}" style="width:80px;height:80px;object-fit:cover;border-radius:6px;border:1px solid #e0e0e0;" /></a>`
                    : `<div style="width:80px;height:80px;display:flex;align-items:center;justify-content:center;background:#f7f7f7;border-radius:6px;border:1px solid #e0e0e0;font-size:11px;font-weight:600;color:#666;text-transform:uppercase;">${esc((f.ext || "file").toUpperCase())}</div>`
                  }
                  <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:14px;color:#222;word-break:break-all;">${esc(f.name || `evidence-${i + 1}.${f.ext || ""}`)}</div>
                    <div style="font-size:12px;color:#999;margin-top:2px;">${esc(f.type || f.ext || "")}</div>
                    <div style="margin-top:6px;display:flex;gap:8px;">
                      <a href="${viewUrl}" target="_blank" class="btn btn-sm" style="border:1px solid #92174d;color:#92174d;background:#fff;padding:4px 10px;font-size:12px;border-radius:6px;text-decoration:none;">View</a>
                      <a href="${dlUrl}" class="btn btn-sm" style="border:1px solid #e0e0e0;color:#222;background:#fff;padding:4px 10px;font-size:12px;border-radius:6px;text-decoration:none;">Download</a>
                    </div>
                  </div>
                </li>
              `;
            }).join("")}
          </ul>
        </div>
      ` : ""}

      <button type="submit" class="btn btn-primary w-full">Approve &amp; Push to GitHub</button>
    </form>

    <hr style="border:none;border-top:1px solid #e0e0e0;margin:32px 0;" />

    <form method="POST" action="/admin/reject" class="space-y-4">
      <input type="hidden" name="id" value="${s.id}" />
      <fieldset class="space-y-4">
        <legend style="color:#c0392b;">Reject Submission</legend>
        <div>
          <label class="label">Reason for rejection (included in email if notifying)</label>
          <textarea class="textarea" name="reason" rows="4" placeholder="e.g. We couldn't verify your celebrant registration, or the profile photo doesn't meet our guidelines…"></textarea>
        </div>
      </fieldset>
      <div style="display:flex;gap:8px;">
        <button type="submit" name="notify" value="yes" class="btn" style="flex:1;background:#c0392b;color:#fff;border:none;" onclick="return confirm('Reject this submission? The celebrant will be emailed with the reason.')">Reject &amp; Notify Celebrant</button>
        <button type="submit" name="notify" value="no" class="btn" style="flex:1;background:#888;color:#fff;border:none;" onclick="return confirm('Reject and delete this submission silently? No email will be sent.')">Reject Silently</button>
      </div>
    </form>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin Edit Form HTML
// ─────────────────────────────────────────────────────────────────────────────

function adminEditFormHtml(slug, existing, env) {
  const e = existing || {};
  const body = e._body || "";
  const locations = (e.location || []).join(", ");
  const categories = e.category || ["Celebrant"];
  const allCategories = ["Celebrant", "MC", "DJ", "Elopement Planner"];
  const tier = e.tier || "registered";

  return `
    <h1>Edit: ${esc(e.title || slug)}</h1>
    <p class="text-sm text-light mb-4">Slug: <code>${esc(slug)}</code> · <a href="${env.SITE_URL}/directory/${slug}/" target="_blank" style="color:#ff385c;">View live listing</a></p>

    <form method="POST" action="/admin/edit" enctype="multipart/form-data" class="space-y-6">
      <input type="hidden" name="slug" value="${escAttr(slug)}" />

      <fieldset class="space-y-4">
        <legend>Admin Settings</legend>
        <div class="grid-2">
          <div>
            <label class="label">Tier</label>
            <select name="tier">
              <option value="registered" ${tier === "registered" ? "selected" : ""}>Registered</option>
              <option value="endorsed" ${tier === "endorsed" ? "selected" : ""}>Endorsed</option>
              <option value="luminary" ${tier === "luminary" ? "selected" : ""}>Luminary</option>
            </select>
          </div>
          <div>
            <label class="label" style="margin-bottom:10px">Featured</label>
            <label style="display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer;">
              <input type="checkbox" name="featured" ${e.featured ? "checked" : ""} /> Feature this listing
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset class="space-y-4">
        <legend>About</legend>
        <div>
          <label class="label" for="title">Name *</label>
          <input class="input" type="text" id="title" name="title" required value="${escAttr(e.title || "")}" />
        </div>
        <div>
          <label class="label" for="brand_name">Brand name</label>
          <input class="input" type="text" id="brand_name" name="brand_name" value="${escAttr(e.title || "")}" />
        </div>
        <div>
          <label class="label" for="meta_title">SEO Meta Title</label>
          <input class="input" type="text" id="meta_title" name="meta_title" value="${escAttr(e.meta_title || "")}" />
        </div>
        <div>
          <label class="label" for="description">Short description</label>
          <textarea class="textarea" id="description" name="description" rows="2">${esc(e.description || "")}</textarea>
        </div>
        <div>
          <label class="label" for="bio">Bio — <a href="https://daringfireball.net/projects/markdown/basics" target="_blank" rel="noopener" style="color:#ff385c;">Markdown</a></label>
          <textarea class="textarea" id="bio" name="bio" rows="10">${esc(body)}</textarea>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
            <button type="button" class="btn btn-sm ai-edit-btn" data-type="better" style="border:1px solid #e0e0e0;background:#fff;">Make it better with AI</button>
            <button type="button" class="btn btn-sm ai-edit-btn" data-type="longer" style="border:1px solid #e0e0e0;background:#fff;">Make it longer with AI</button>
            <button type="button" class="btn btn-sm ai-edit-btn" data-type="shorter" style="border:1px solid #e0e0e0;background:#fff;">Make it shorter with AI</button>
            <button type="button" class="btn btn-sm ai-edit-btn" data-type="helpful" style="border:1px solid #e0e0e0;background:#fff;">Make it more helpful with AI</button>
          </div>
          <div id="ai-status" style="display:none;margin-top:8px;" class="text-sm"></div>
        </div>
      </fieldset>

      <fieldset class="space-y-4">
        <legend>Contact</legend>
        <div>
          <label class="label" for="email">Email</label>
          <input class="input" type="email" id="email" name="email" value="${escAttr(e.email || "")}" />
        </div>
        <div>
          <label class="label" for="website">Website</label>
          <input class="input" type="url" id="website" name="website" value="${escAttr(e.website || "")}" />
        </div>
        <div class="grid-2">
          <div>
            <label class="label" for="phone">Phone</label>
            <input class="input" type="tel" id="phone" name="phone" value="${escAttr(e.phone || "")}" />
          </div>
          <div>
            <label class="label" for="address">Address</label>
            <input class="input" type="text" id="address" name="address" value="${escAttr(e.address || "")}" />
          </div>
        </div>
        <div>
          <label class="label" for="year_started">Year started as celebrant</label>
          <input class="input" type="number" id="year_started" name="year_started" min="1950" max="${new Date().getUTCFullYear()}" value="${escAttr(e.year_started || "")}" placeholder="e.g. 2015" />
          <p class="hint">Drives the "Class of {year}" 🎓 award on their Trophy Shelf.</p>
        </div>
      </fieldset>

      <fieldset class="space-y-4">
        <legend>Images</legend>
        <div>
          <label class="label">Profile photo</label>
          ${typeof e.image === 'string' && e.image ? `<div style="margin-bottom:8px"><img src="${resolveImageUrl(e.image, env)}" alt="Current photo" style="max-width:200px;max-height:200px;border-radius:8px;border:1px solid #e0e0e0" /></div>` : ""}
          <input class="input" type="file" name="image_file" accept="image/*" style="padding:8px" />
          ${typeof e.image === 'string' && e.image ? `<input type="hidden" name="existing_image" value="${escAttr(e.image)}" />` : ""}
        </div>
        <div>
          <label class="label">Logo</label>
          ${typeof e.logo === 'string' && e.logo ? `<div style="margin-bottom:8px"><img src="${resolveImageUrl(e.logo, env)}" alt="Current logo" style="max-width:160px;max-height:60px;object-fit:contain" /></div>` : ""}
          <input class="input" type="file" name="logo_file" accept="image/*" style="padding:8px" />
          ${typeof e.logo === 'string' && e.logo ? `<input type="hidden" name="existing_logo" value="${escAttr(e.logo)}" />` : ""}
        </div>
      </fieldset>

      <fieldset class="space-y-4">
        <legend>Location &amp; Services</legend>
        <div>
          <label class="label" for="location">Locations *</label>
          <input class="input" type="text" id="location" name="location" required value="${escAttr(locations)}" />
        </div>
        <div>
          <label class="label">Services</label>
          <div class="checkbox-row">
            ${allCategories.map(cat => `
              <label><input type="checkbox" name="category" value="${cat}" ${categories.includes(cat) ? "checked" : ""} /> ${cat}</label>
            `).join("")}
          </div>
        </div>
        <div class="checkbox-row mt-4">
          <label><input type="checkbox" name="australia_wide" ${e.australia_wide ? "checked" : ""} /> Australia wide</label>
          <label><input type="checkbox" name="international" ${e.international ? "checked" : ""} /> International</label>
          <input type="hidden" name="opt_enquiries_present" value="1" />
          <label><input type="checkbox" name="accepts_agent_enquiries" ${e.accepts_agent_enquiries === true ? "checked" : ""} /> Accepts AI-agent-relayed enquiries (explicit opt-in)</label>
        </div>
      </fieldset>

      <fieldset class="space-y-4">
        <legend>Social Media</legend>
        <div>
          <label class="label">Instagram</label>
          <input class="input" type="url" name="instagram" value="${escAttr(e.social?.instagram || "")}" />
        </div>
        <div>
          <label class="label">Facebook</label>
          <input class="input" type="url" name="facebook" value="${escAttr(e.social?.facebook || "")}" />
        </div>
        <div>
          <label class="label">Pinterest</label>
          <input class="input" type="url" name="pinterest" value="${escAttr(e.social?.pinterest || "")}" />
        </div>
      </fieldset>

      <button type="submit" class="btn btn-primary w-full">Save to GitHub</button>
    </form>

    <script>
      document.querySelectorAll('.ai-edit-btn').forEach(btn => {
        btn.addEventListener('click', async function() {
          const editType = this.dataset.type;
          const bio = document.getElementById('bio').value;
          if (!bio.trim()) { alert('Write some bio text first.'); return; }

          const formData = {
            bio, edit_type: editType,
            title: document.getElementById('title')?.value || '',
            brand_name: document.getElementById('brand_name')?.value || '',
            description: document.getElementById('description')?.value || '',
            website: document.getElementById('website')?.value || '',
            location: document.getElementById('location')?.value || '',
            category: [...document.querySelectorAll('input[name="category"]:checked')].map(c => c.value),
          };

          document.querySelectorAll('.ai-edit-btn').forEach(b => { b.disabled = true; });
          this.textContent = 'Thinking...';
          const statusEl = document.getElementById('ai-status');
          statusEl.style.display = 'block';
          statusEl.style.color = '#666';
          statusEl.textContent = 'AI is rewriting the bio...';

          try {
            const res = await fetch('/ai-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            document.getElementById('bio').value = data.bio;
            statusEl.style.color = '#16a34a';
            statusEl.textContent = 'Done! Review the updated bio above.';
          } catch (err) {
            statusEl.style.color = '#dc2626';
            statusEl.textContent = 'AI edit failed: ' + err.message;
          }

          document.querySelectorAll('.ai-edit-btn').forEach(b => { b.disabled = false; });
          this.textContent = {better:'Make it better with AI',longer:'Make it longer with AI',shorter:'Make it shorter with AI',helpful:'Make it more helpful with AI'}[editType];
        });
      });
    </script>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function generateShortId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function slugify(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 60);
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  } catch { return iso; }
}

function statusLabel(status) {
  const labels = { pending_ai: "Processing", pending_review: "Pending Review", approved: "Approved" };
  return labels[status] || status;
}

function sanitiseHref(url) {
  // Only allow http/https URLs — block javascript:, data:, vbscript:, etc.
  const trimmed = url.replace(/\s/g, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/"/g, "&quot;");
  return "";
}

function formatBulkEmailBody(text) {
  // Escape HTML entities first
  let html = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Links: [text](url) — sanitise href to prevent javascript: injection
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const safe = sanitiseHref(url);
    return safe ? `<a href="${safe}" style="color:#2563eb">${label}</a>` : label;
  });

  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic: *text*
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Headers: # h1, ## h2, ### h3 (at start of line)
  html = html.replace(/^### (.+)$/gm, '<h3 style="margin:16px 0 8px">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="margin:16px 0 8px">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="margin:16px 0 8px">$1</h1>');

  // Unordered lists: lines starting with - or *
  html = html.replace(/^(?:[*-]) (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul style="margin:8px 0;padding-left:24px">$&</ul>');

  // Line breaks (but not after block elements)
  html = html.replace(/\n/g, "<br>");
  // Clean up extra <br> around block elements
  html = html.replace(/<br>(<\/?(?:ul|li|h[1-3]))/g, "$1");
  html = html.replace(/(<\/(?:ul|h[1-3])>)<br>/g, "$1");

  return html;
}

function extractTextFromHtml(html) {
  // Strip scripts and styles, then tags, then collapse whitespace
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Image optimisation
// ─────────────────────────────────────────────────────────────────────────────

async function optimiseImage(file, { maxWidth = 1200, quality = 82 } = {}) {
  const buffer = await file.arrayBuffer();

  // Try Cloudflare Image Resizing first
  try {
    const blob = new Blob([buffer], { type: file.type });
    const tempUrl = URL.createObjectURL(blob);
    const transformed = await fetch(tempUrl, {
      cf: {
        image: {
          width: maxWidth,
          quality: quality,
          format: "webp",
          fit: "scale-down",
        },
      },
    });
    URL.revokeObjectURL(tempUrl);
    if (transformed.ok) {
      const webpBuffer = await transformed.arrayBuffer();
      return { base64: arrayBufferToBase64(webpBuffer) };
    }
  } catch (e) {
    console.log("CF Image Resizing not available:", e.message);
  }

  // Fallback: OffscreenCanvas
  try {
    const blob = new Blob([buffer], { type: file.type });
    const bitmap = await createImageBitmap(blob);
    let width = bitmap.width;
    let height = bitmap.height;
    if (width > maxWidth) {
      height = Math.round((height * maxWidth) / width);
      width = maxWidth;
    }
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const webpBlob = await canvas.convertToBlob({ type: "image/webp", quality: quality / 100 });
    const webpBuffer = await webpBlob.arrayBuffer();
    return { base64: arrayBufferToBase64(webpBuffer) };
  } catch (e) {
    console.log("OffscreenCanvas fallback failed:", e.message);
  }

  // Last resort: store original
  console.log("No image optimisation available, storing original");
  return { base64: arrayBufferToBase64(buffer) };
}

function isSvg(file) {
  return file.type === "image/svg+xml" || (file.name || "").toLowerCase().endsWith(".svg");
}

function resolveImageUrl(imagePath, env) {
  if (!imagePath) return "";
  if (imagePath.startsWith("http")) return imagePath;
  const cleaned = imagePath.replace(/^\.\.\/\.\.\//, "src/");
  return `${env.WORKER_URL}/asset?path=${encodeURIComponent(cleaned)}`;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function getFileExtension(filename, mimeType) {
  const fromName = (filename || "").split(".").pop()?.toLowerCase();
  if (fromName && ["jpg", "jpeg", "png", "webp", "gif", "svg", "avif"].includes(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }
  const mimeMap = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "image/gif": "gif", "image/svg+xml": "svg", "image/avif": "avif",
  };
  return mimeMap[mimeType] || "jpg";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
}

function isSafeUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    // Block private/reserved IPs and localhost
    if (host === "localhost" || host === "[::1]") return false;
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/.test(host)) return false;
    // Block common internal hostnames
    if (/\.(internal|local|localhost|test)$/.test(host)) return false;
    return true;
  } catch { return false; }
}

function esc(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escAttr(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function linkifyLines(str) {
  return (str || "").split(/\r?\n/).map(raw => {
    const line = raw.trim();
    if (!line) return "";
    const urlMatch = line.match(/^(https?:\/\/\S+)$/i);
    if (urlMatch) {
      const url = urlMatch[1];
      return `<a href="${escAttr(url)}" target="_blank" rel="noopener" style="color:#92174d;word-break:break-all;">${esc(url)}</a>`;
    }
    return esc(line);
  }).filter(Boolean).join("<br/>");
}

function escYaml(str) {
  return (str || "").replace(/"/g, '\\"');
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const lines = match[1].split("\n");
  const obj = {};
  let currentKey = null;
  let inObject = null;

  for (const line of lines) {
    const arrayMatch = line.match(/^  - (.+)/);
    if (arrayMatch && currentKey) {
      if (!obj[currentKey]) obj[currentKey] = [];
      obj[currentKey].push(arrayMatch[1].trim().replace(/^"(.*)"$/, "$1"));
      continue;
    }

    const nestedMatch = line.match(/^  (\w+):\s*"?([^"]*)"?\s*$/);
    if (nestedMatch && inObject) {
      if (!obj[inObject]) obj[inObject] = {};
      obj[inObject][nestedMatch[1]] = nestedMatch[2];
      continue;
    }

    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      let val = kvMatch[2].trim();
      if (val === "") {
        inObject = currentKey;
        continue;
      }
      inObject = null;
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("[") && val.endsWith("]")) {
        val = val.slice(1, -1).split(",").map(s => s.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
      }
      if (val === "true") val = true;
      if (val === "false") val = false;
      obj[currentKey] = val;
    }
  }
  return obj;
}

function parseBody(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return match ? match[1].trim() : "";
}

function redirect(url) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function corsHeaders(request, env) {
  const origin = request?.headers?.get("Origin") || "";
  const allowed = [env?.SITE_URL, env?.WORKER_URL].filter(Boolean);
  const allowOrigin = allowed.some(a => origin === a || origin === a.replace(/\/$/, "")) ? origin : allowed[0] || "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
