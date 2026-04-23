// WebMCP tool registrations — exposes key directory actions to AI agents
// running in the browser (Chrome EPP, etc.). Feature-detects the API so this
// is a no-op in browsers that don't implement it.
//
// Spec: https://webmachinelearning.github.io/webmcp/
// Supports both `registerTool()` (current spec) and `provideContext()` (earlier
// drafts) so it works across the origin-trial history without breaking.

(function () {
  if (typeof navigator === "undefined") return;
  var mc = navigator.modelContext;
  if (!mc) return;

  function slugifyLocation(input) {
    return String(input || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  var tools = [
    {
      name: "search_celebrants",
      title: "Search celebrants",
      description:
        "Search the Australian Wedding Celebrants directory for a marriage celebrant by name, city, region, or specialty (e.g. 'elopement', 'Byron Bay', 'MC'). Opens the search results page with matches.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Free-text query — celebrant name, location, or specialty.",
          },
        },
        required: ["query"],
      },
      execute: async function (input) {
        var q = (input && input.query) || "";
        var url = "/search/?q=" + encodeURIComponent(q);
        window.location.assign(url);
        return { navigated: true, url: url };
      },
    },
    {
      name: "browse_celebrants_by_location",
      title: "Browse by location",
      description:
        "Open the directory filtered to a specific Australian location. Accepts city or region names like 'Sydney', 'Hobart', 'Byron Bay', 'Sunshine Coast'.",
      inputSchema: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "Australian city, town, or region name.",
          },
        },
        required: ["location"],
      },
      execute: async function (input) {
        var slug = slugifyLocation(input && input.location);
        if (!slug) return { error: "A location is required." };
        var url = "/directory/location/" + slug + "/";
        window.location.assign(url);
        return { navigated: true, url: url };
      },
    },
    {
      name: "browse_celebrants_by_tier",
      title: "Browse by recognition tier",
      description:
        "Show celebrants at a specific recognition tier. 'luminary' is the highest tier (7+ years, extensive verified reviews, industry recognition); 'endorsed' is mid (insured, 100+ ceremonies, verified reviews); 'registered' is the baseline (Commonwealth-authorised celebrants with Cert IV).",
      inputSchema: {
        type: "object",
        properties: {
          tier: {
            type: "string",
            enum: ["luminary", "endorsed", "registered"],
          },
        },
        required: ["tier"],
      },
      execute: async function (input) {
        var paths = {
          luminary: "/luminaries/",
          endorsed: "/endorsed/",
          registered: "/registered/",
        };
        var url = paths[input && input.tier];
        if (!url) return { error: "Unknown tier." };
        window.location.assign(url);
        return { navigated: true, url: url };
      },
    },
    {
      name: "view_celebrant_profile",
      title: "View a celebrant's profile",
      description:
        "Open a specific celebrant's profile page by their directory slug (the last path segment in /directory/<slug>/). Useful after a search surfaces a candidate.",
      inputSchema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "The celebrant's directory slug, e.g. 'josh-withers-ybt9'.",
          },
        },
        required: ["slug"],
      },
      execute: async function (input) {
        var slug = String((input && input.slug) || "").replace(/^\/+|\/+$/g, "");
        if (!slug) return { error: "A celebrant slug is required." };
        var url = "/directory/" + slug + "/";
        window.location.assign(url);
        return { navigated: true, url: url };
      },
    },
    {
      name: "submit_celebrant_listing",
      title: "Submit or edit a celebrant listing",
      description:
        "Start the flow for a marriage celebrant to submit a new listing or edit their existing one. Opens the submission page where they enter their email to receive a magic link.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async function () {
        var url = "/submit/";
        window.location.assign(url);
        return { navigated: true, url: url };
      },
    },
  ];

  // Primary API per the current draft spec: registerTool(tool).
  if (typeof mc.registerTool === "function") {
    tools.forEach(function (tool) {
      try {
        mc.registerTool(tool);
      } catch (e) {
        // Ignore duplicate registrations or schema rejections.
      }
    });
    return;
  }

  // Fallback for older drafts that used provideContext({ tools: [...] }).
  if (typeof mc.provideContext === "function") {
    try {
      mc.provideContext({ tools: tools });
    } catch (e) {
      // Ignore.
    }
  }
})();
