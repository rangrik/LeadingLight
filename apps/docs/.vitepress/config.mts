import { defineConfig } from "vitepress";

const repo = "https://github.com/rangrik/LeadingLight";

export default defineConfig({
  title: "LeadingLight",
  description: "A local-first notes app for macOS. Every note is an object with a type, written in a block editor.",
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
    ["meta", { name: "theme-color", content: "#15151a" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "LeadingLight documentation" }],
    ["meta", { property: "og:description", content: "How to install and use LeadingLight, a local-first notes app for macOS." }],
  ],
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Guide", link: "/guide/", activeMatch: "^/guide/" },
      { text: "Features", link: "/write/editor", activeMatch: "^/(write|organize|workspace|capture|ai|sync|customize)/" },
      { text: "Developers", link: "/develop/", activeMatch: "^/develop/" },
      { text: "Download", link: `${repo}/releases` },
    ],
    sidebar: [
      {
        text: "Getting started",
        items: [
          { text: "What is LeadingLight", link: "/guide/" },
          { text: "Install", link: "/guide/install" },
          { text: "Your first ten minutes", link: "/guide/first-steps" },
          { text: "Objects, types and links", link: "/guide/concepts" },
          { text: "Your data and privacy", link: "/guide/privacy" },
        ],
      },
      {
        text: "Writing",
        collapsed: false,
        items: [
          { text: "The block editor", link: "/write/editor" },
          { text: "Block kinds", link: "/write/blocks" },
          { text: "Selecting and moving blocks", link: "/write/selecting-blocks" },
          { text: "Pasting Markdown", link: "/write/markdown" },
          { text: "Sidenotes, thoughts and essays", link: "/write/sidenotes" },
          { text: "Writing tools", link: "/write/writing-tools" },
          { text: "Writing coach", link: "/write/writing-coach" },
        ],
      },
      {
        text: "Organizing",
        collapsed: false,
        items: [
          { text: "Pages and the sidebar", link: "/organize/pages" },
          { text: "Icons, covers and descriptions", link: "/organize/page-header" },
          { text: "Properties", link: "/organize/properties" },
          { text: "Types and templates", link: "/organize/types" },
          { text: "Links and backlinks", link: "/organize/links" },
          { text: "Lists, tables and boards", link: "/organize/views" },
          { text: "Tags and daily notes", link: "/organize/tags-daily" },
          { text: "Tasks and new objects", link: "/organize/tasks" },
          { text: "History and authorship", link: "/organize/history" },
        ],
      },
      {
        text: "Workspace",
        collapsed: false,
        items: [
          { text: "Sidebar, panes and tabs", link: "/workspace/layout" },
          { text: "The bar", link: "/workspace/bar" },
        ],
      },
      {
        text: "Capture",
        collapsed: false,
        items: [
          { text: "Idea capture", link: "/capture/idea-capture" },
          { text: "Quick capture", link: "/capture/quick-capture" },
          { text: "Voice notes", link: "/capture/voice" },
          { text: "Saving web pages", link: "/capture/web-sources" },
          { text: "The capture inbox", link: "/capture/inbox" },
        ],
      },
      {
        text: "AI and agents",
        collapsed: false,
        items: [
          { text: "Overview and setup", link: "/ai/" },
          { text: "Ask Claude about a page", link: "/ai/ask" },
          { text: "Tail and suggestions", link: "/ai/tail" },
          { text: "Projects linked to folders", link: "/ai/projects" },
          { text: "Project chat", link: "/ai/project-chat" },
          { text: "Assigning tasks to agents", link: "/ai/tasks-for-agents" },
          { text: "The Feed and feedback", link: "/ai/feed-feedback" },
          { text: "The built-in browser", link: "/ai/browser" },
        ],
      },
      {
        text: "Sync and devices",
        collapsed: false,
        items: [
          { text: "Accounts and encrypted sync", link: "/sync/" },
          { text: "Agents from a browser", link: "/sync/pairing" },
          { text: "LeadingLight on iPad", link: "/sync/ipad" },
        ],
      },
      {
        text: "Make it yours",
        collapsed: false,
        items: [
          { text: "Appearance and themes", link: "/customize/appearance" },
          { text: "Keyboard shortcuts", link: "/customize/shortcuts" },
          { text: "Settings reference", link: "/customize/settings" },
        ],
      },
      {
        text: "Help",
        items: [{ text: "FAQ and known limits", link: "/guide/faq" }],
      },
      {
        text: "Developers",
        collapsed: true,
        items: [
          { text: "Build from source", link: "/develop/" },
          { text: "Architecture", link: "/develop/architecture" },
          { text: "Contributing", link: "/develop/contributing" },
          { text: "Releases", link: "/develop/releases" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: repo }],
    search: { provider: "local" },
    editLink: { pattern: `${repo}/edit/main/apps/docs/:path`, text: "Edit this page on GitHub" },
    outline: { level: [2, 3] },
    footer: {
      message: "LeadingLight is MIT licensed. Preview builds are unsigned and for Apple Silicon Macs.",
      copyright: "© 2026 Pranav Kanade",
    },
  },
});
