import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowDown, ArrowDownLeft, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronRight, Circle, FileText, Lightbulb, Link2, LockKeyhole, Monitor, Plus, ScanLine, Sparkle } from "lucide-react";
import { Button } from "@leadinglight/ui/components/button";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@leadinglight/ui/components/tabs";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@leadinglight/ui/components/accordion";
import "./styles.css";

const releases = "https://github.com/rangrik/LeadingLight/releases";
const repository = "https://github.com/rangrik/LeadingLight";
const stages = [
  { id: "source", number: "01", label: "A passing thought", title: <>Catch it<br />while it’s here.</>, text: "A line from a book. A question on a walk. Give it a place in a daily note before it slips away.", feature: "Daily notes & quick capture", next: "Find the connection" },
  { id: "connection", number: "02", label: "A connection", title: <>One thought.<br />Another way in.</>, text: "Link a note to an idea, a person, or a book. Backlinks keep the way back, so an old thought can become useful again.", feature: "Typed objects & backlinks", next: "See what it becomes" },
  { id: "draft", number: "03", label: "Something of your own", title: <>Stay with it.<br />See where it goes.</>, text: "Bring your sources beside your writing. Keep the small asides in sidenotes. Give the thought enough room to take shape.", feature: "Block writing & sidenotes", next: "Follow it again" },
] as const;

function Download({ className = "", label = "Get LeadingLight" }: { className?: string; label?: string }) {
  return <Button className={`download ${className}`} render={<a href={releases} />}><span>{label}</span><ArrowUpRight aria-hidden="true" /></Button>;
}

function App() {
  const [stage, setStage] = useState("source");
  return <div className="site isolate">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header wrap">
      <a className="brand" href="#" aria-label="LeadingLight home"><span className="brand-symbol"><Sparkle aria-hidden="true" /></span>LeadingLight</a>
      <nav className="desktop-nav" aria-label="Main navigation"><a href="#the-light-table">The light table</a><a href="#on-your-mac">On your Mac</a><a href={repository}>Open source <ArrowUpRight aria-hidden="true" /></a></nav>
      <Button className="header-download" variant="outline" render={<a href="#download" />}>Get the preview <ArrowDown aria-hidden="true" /></Button>
    </header>

    <main id="main">
      <section className="hero wrap" aria-labelledby="hero-title">
        <div className="hero-topline"><span><span className="status-dot" />A PLACE FOR YOUR NEXT IDEA</span><span className="hero-coordinate">LOCAL FIRST / MAC FIRST</span></div>
        <div className="hero-art" aria-hidden="true"><img src="/light-table.webp" alt="" width="1600" height="1400" fetchPriority="high" /></div>
        <h1 className="hero-heading" id="hero-title">Follow a <span>thought.</span></h1><div className="hero-copy"><p>A local-first notes app for the things<br className="desktop-break" /> you’re still figuring out.</p><div className="hero-action"><Download /><span className="preview-note">Early Apple Silicon preview.<br />Unsigned and not notarized by Apple.</span></div></div>
        <div className="art-caption"><span className="caption-cross">+</span><span>THINGS BECOME CLEARER<br />WHEN THEY COME TOGETHER.</span><span className="caption-line" /></div>
        <div className="hero-bottom"><span>FROM THE FIRST SPARK<br />TO A THOUGHT THAT’S YOURS.</span><a href="#the-light-table">Take a closer look <ArrowDown aria-hidden="true" /></a><span className="hero-index">01 — 03</span></div>
      </section>

      <div className="yellow-ribbon" aria-hidden="true"><span>CAPTURE.</span><Plus /><span>CONNECT.</span><Plus /><span>MAKE SOMETHING OF IT.</span><ArrowDownLeft /></div>

      <section className="light-table wrap" id="the-light-table" aria-labelledby="table-title">
        <div className="section-intro"><p className="eyebrow"><span className="tiny-cross">+</span> THE LIGHT TABLE</p><h2 id="table-title">Good ideas rarely<br />arrive <span>fully formed.</span></h2><p className="section-description">They start as something small.<br />Here’s how one thought finds its way.</p></div>
        <Tabs value={stage} onValueChange={(value) => setStage(String(value))} className="story-tabs">
          <TabsList className="story-track" variant="underline" aria-label="Follow a thought">
            {stages.map((item) => <TabsTab className="story-tab" key={item.id} value={item.id}><span className="step-number">{item.number}</span><span>{item.label}</span><ArrowRight aria-hidden="true" /></TabsTab>)}
          </TabsList>
          {stages.map((item, index) => <TabsPanel key={item.id} value={item.id} className="story-panel">
            <div className="story-explanation"><span className="eyebrow">{item.number} / THE {item.id.toUpperCase()}</span><h3>{item.title}</h3><p>{item.text}</p><span className="feature-label"><Check aria-hidden="true" />{item.feature}</span><Button className="next-stage" variant="ghost" onClick={() => setStage(stages[(index + 1) % stages.length].id)}>{item.next}<ArrowRight aria-hidden="true" /></Button></div>
            <div className={`specimen specimen-${item.id}`}>
              <div className="specimen-header"><span className="window-dots" aria-hidden="true"><i /><i /><i /></span><span>LeadingLight</span><span><ScanLine aria-hidden="true" /></span></div>
              <div className="specimen-body">
                <div className="note-path"><span>My space</span><ChevronRight aria-hidden="true" /><span>{item.id === "source" ? "Daily notes" : item.id === "connection" ? "Ideas" : "Essays"}</span></div>
                {item.id === "source" && <><span className="note-kind"><Circle aria-hidden="true" /> DAILY NOTE</span><h4>A walk, without<br />a destination</h4><div className="note-meta"><span>Wednesday</span><span>09:41 am</span></div><p>The most useful part of the walk was getting lost.</p><p>I took the long way home. No podcast, no route. Just enough quiet to notice a thought I’d been walking past all week.</p><Button variant="ghost" className="inline-note-link" onClick={() => setStage("connection")}><Lightbulb aria-hidden="true" />Wandering is a method<ArrowUpRight aria-hidden="true" /></Button><p className="note-aside">Something to come back to.</p></>}
                {item.id === "connection" && <><span className="note-kind"><Lightbulb aria-hidden="true" /> IDEA</span><h4>Wandering<br />is a method</h4><div className="note-meta"><span>Related to</span><span>Attention</span></div><p>A wrong turn is sometimes the beginning of a better question.</p><p>When I stop trying to get somewhere, I start seeing what’s already here.</p><div className="backlink-box"><span><Link2 aria-hidden="true" /> LINKED FROM</span><Button variant="ghost" className="backlink" onClick={() => setStage("source")}><FileText aria-hidden="true" />A walk, without a destination<ArrowUpRight aria-hidden="true" /></Button></div><Button variant="ghost" className="inline-note-link" onClick={() => setStage("draft")}><BookOpen aria-hidden="true" />The useful detour<ArrowUpRight aria-hidden="true" /></Button></>}
                {item.id === "draft" && <><span className="note-kind"><BookOpen aria-hidden="true" /> ESSAY</span><h4>The useful<br />detour</h4><div className="note-meta"><span>In progress</span><span>Made of smaller thoughts</span></div><p>We tend to describe a good day by how much ground we covered. But sometimes the useful part happens off the route.</p><p className="highlighted-passage">Maybe attention begins where the plan ends.<sup>1</sup></p><Button variant="ghost" className="inline-note-link" onClick={() => setStage("connection")}><Lightbulb aria-hidden="true" />Wandering is a method<ArrowUpRight aria-hidden="true" /></Button><aside className="sidenote"><span>1</span>A thought from Wednesday’s walk. Keep this close while writing.</aside></>}
              </div>
              <div className="specimen-footer"><span><span className="save-dot" />Saved on this Mac</span><span>{item.id === "source" ? "A small beginning" : item.id === "connection" ? "One more connection" : "Still becoming"}</span></div>
            </div>
          </TabsPanel>)}
        </Tabs>
        <p className="demo-caption"><span>ILLUSTRATIVE NOTES · INTERACTIVE PRODUCT STORY</span><span>Choose a step. Follow a link. See what connects.</span></p>
      </section>

      <section className="keep-section" id="on-your-mac" aria-labelledby="keep-title">
        <div className="wrap keep-layout"><div className="keep-heading"><p className="eyebrow"><LockKeyhole aria-hidden="true" /> CLOSE TO HOME</p><h2 id="keep-title">Your mind.<br />Your Mac.</h2><p>Your notes live on your device.<br />A place to think that stays yours.</p><div className="local-seal"><Monitor aria-hidden="true" /><span>LOCAL-FIRST<br />BY DESIGN</span><ArrowUpRight className="seal-arrow" aria-hidden="true" /></div></div>
        <div className="keep-details"><article><span className="detail-number">01</span><div><h3>A place for every kind of thought.</h3><p>A book is a book. A person is a person. Notes have types and properties, so the things in your life don’t have to fit into one long list.</p></div></article><article><span className="detail-number">02</span><div><h3>Enough structure. Room to write.</h3><p>A calm block editor, linked pages, and sidenotes. Put a source beside a draft and keep the thread in view.</p></div></article><article><span className="detail-number">03</span><div><h3>Small moments, kept.</h3><p>Daily notes and quick capture give passing thoughts somewhere to land. Come back when you have something to make of them.</p></div></article><p className="local-caveat">Notes are stored locally. Optional image search sends search terms and photo selections to the shared Unsplash service.</p></div></div>
      </section>

      <section className="questions wrap" aria-labelledby="questions-title"><div><p className="eyebrow"><span className="tiny-cross">+</span> A FEW THINGS TO KNOW</p><h2 id="questions-title">Before you<br />begin.</h2></div><Accordion className="faq" defaultValue={[]}><AccordionItem value="preview"><AccordionTrigger>What’s available today?</AccordionTrigger><AccordionPanel><p>LeadingLight is in early development. The current download is an Apple Silicon Mac preview, with notes, object types, a block editor, linked pages, daily notes, and more. Expect rough edges as the app takes shape.</p></AccordionPanel></AccordionItem><AccordionItem value="installation"><AccordionTrigger>What should I know before installing?</AccordionTrigger><AccordionPanel><p>Preview builds are unsigned and not notarized by Apple. macOS may block the first launch. Read the instructions and release notes on the <a href={releases}>official GitHub releases page</a> before installing.</p></AccordionPanel></AccordionItem><AccordionItem value="local"><AccordionTrigger>Where do my notes live?</AccordionTrigger><AccordionPanel><p>Your notes live in a local database on your Mac. Optional image search uses a shared Unsplash service; it sends your search terms and photo selections.</p></AccordionPanel></AccordionItem><AccordionItem value="source"><AccordionTrigger>Can I see how it’s made?</AccordionTrigger><AccordionPanel><p>Yes. LeadingLight’s own code is MIT licensed and available on <a href={repository}>GitHub</a>. You can read the source, follow development, and report issues there.</p></AccordionPanel></AccordionItem></Accordion></section>

      <section className="closing wrap" id="download" aria-labelledby="closing-title"><div><p className="eyebrow"><span className="status-dot" /> YOUR NEXT THOUGHT STARTS HERE</p><h2 id="closing-title">See where<br />it takes you.</h2></div><div className="closing-action"><Download label="Download the Mac preview" /><p>For Apple Silicon · Early development<br />Unsigned and not notarized by Apple.</p><a href={releases}>Read the release notes <ArrowUpRight aria-hidden="true" /></a></div></section>
    </main>

    <footer className="site-footer wrap"><div className="footer-wordmark" aria-hidden="true">LeadingLight<ArrowUpRight aria-hidden="true" /></div><div className="footer-line"><a className="footer-brand" href="#">LeadingLight</a><p>A little room for a lot of thought.</p><a href={repository}>Open source on GitHub <ArrowUpRight aria-hidden="true" /></a></div></footer>
  </div>;
}


createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
