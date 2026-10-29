import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowDown, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronRight, Circle, CornerDownRight, FileText, Lightbulb, Link2, LockKeyhole, Sun, UserRound } from "lucide-react";
import { Button } from "@leadinglight/ui/components/button";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@leadinglight/ui/components/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionPanel } from "@leadinglight/ui/components/accordion";
import "./styles.css";

const RELEASES = "https://github.com/rangrik/LeadingLight/releases";
const REPOSITORY = "https://github.com/rangrik/LeadingLight";
type Kind = "idea" | "book" | "person";
const kinds: { id: Kind; label: string; number: string; icon: typeof Lightbulb; title: string; description: string }[] = [
  { id: "idea", label: "Ideas", number: "01", icon: Lightbulb, title: "The art of noticing", description: "Some thoughts don’t fit in a box. Give them a page, then see where they lead." },
  { id: "book", label: "Books", number: "02", icon: BookOpen, title: "Ways of Seeing", description: "Keep the book, your reading notes and the ideas it sparked in the same collection." },
  { id: "person", label: "People", number: "03", icon: UserRound, title: "John Berger", description: "A name becomes a starting point. Follow it back to the books and thoughts connected to it." },
];

function Download({ className = "", label = "Get the Mac preview" }: { className?: string; label?: string }) {
  return <Button className={`download ${className}`} render={<a href={RELEASES} target="_blank" rel="noreferrer" />}>{label}<ArrowUpRight aria-hidden="true" /></Button>;
}

function ObjectLink({ kind, children, onSelect }: { kind: Kind; children: React.ReactNode; onSelect: (kind: Kind) => void }) {
  return <Button variant="link" className="object-link" onClick={() => onSelect(kind)}>{children}<ArrowUpRight aria-hidden="true" /></Button>;
}

function Specimen({ kind, onSelect }: { kind: Kind; onSelect: (kind: Kind) => void }) {
  const item = kinds.find((entry) => entry.id === kind)!;
  const Icon = item.icon;
  return <div className={`specimen specimen-${kind}`}>
    <figure className="specimen-object">
      <div className="specimen-coordinates"><span>LL / COLLECTION</span><span>OBJECT {item.number}</span></div>
      <img src={`/${kind}.webp`} alt={kind === "idea" ? "An interwoven polished silver knot, a sculpture for a connected idea" : kind === "book" ? "A cobalt blue sculpture of an open book" : "A yellow sculptural figure, representing a person"} width="1500" height="1500" loading="lazy" />
      <figcaption><span><span className="caption-dot" />{kind.toUpperCase()}</span><span>A SHAPE FOR A THOUGHT</span></figcaption>
    </figure>
    <div className="specimen-note">
      <div className="note-chrome"><span><Icon size={14} /> {item.label}<ChevronRight size={12} />{item.title}</span><span className="saved"><Check size={12} /> Saved locally</span></div>
      <article className="note-content">
        <div className="note-type"><Icon size={19} /><span>{kind === "person" ? "Person" : kind === "book" ? "Book" : "Idea"}</span></div>
        <h3>{item.title}</h3>
        {kind === "idea" && <>
          <div className="property"><span>Theme</span><span>Attention</span></div>
          <p>There’s a difference between looking at something and really seeing it.</p>
          <p>What if a good idea begins with a little more attention to the things already around us?</p>
          <div className="note-callout"><CornerDownRight size={16} /><span>A thread to follow<br /><ObjectLink kind="book" onSelect={onSelect}>Ways of Seeing</ObjectLink></span></div>
          <div className="note-backlinks"><Link2 size={14} /><span>Connected to 1 book in this example</span></div>
        </>}
        {kind === "book" && <>
          <div className="property"><span>Author</span><ObjectLink kind="person" onSelect={onSelect}>John Berger</ObjectLink></div>
          <div className="property"><span>Published</span><span>1972</span></div>
          <h4>Notes in the margins</h4>
          <p>A book to return to when familiar things begin to feel invisible. Pay attention to the frame as well as the picture.</p>
          <div className="note-backlinks"><Link2 size={14} /><span>Linked from</span><ObjectLink kind="idea" onSelect={onSelect}>The art of noticing</ObjectLink></div>
        </>}
        {kind === "person" && <>
          <div className="property"><span>Known for</span><span>Writing · Art criticism</span></div>
          <h4>A different way to look</h4>
          <p>Writer and art critic. A person to keep close to a collection about images, attention and how we see.</p>
          <div className="note-callout"><BookOpen size={16} /><span>In this collection<br /><ObjectLink kind="book" onSelect={onSelect}>Ways of Seeing</ObjectLink></span></div>
          <div className="note-backlinks"><Link2 size={14} /><span>1 book points back to this person</span></div>
        </>}
      </article>
      <div className="note-foot"><span>ILLUSTRATIVE NOTES</span><span>YOUR WORDS. YOUR CONNECTIONS.</span></div>
    </div>
  </div>;
}

function App() {
  const [kind, setKind] = useState<Kind>("idea");
  return <div className="isolate cabinet">
    <a className="skip-link" href="#main">Skip to content</a>
    <main id="main">
    <section className="orange-opening">
      <header className="site-header wrap">
        <a href="#" className="wordmark" aria-label="LeadingLight home"><Sun strokeWidth={2.2} /><span>LeadingLight</span></a>
        <nav aria-label="Main navigation"><a href="#collection">The collection</a><a href="#details">The details</a></nav>
        <Download className="header-download" label="Download preview" />
      </header>
        <section className="hero wrap" aria-labelledby="hero-heading">
          <div className="hero-topline"><span>NOTES FOR A LIFE OF NOTICING</span><span>LOCAL-FIRST / MADE FOR MAC</span></div>
          <div className="hero-composition">
            <div className="hero-inventory">{kinds.map((item) => <figure className={`inventory-object inventory-${item.id}`} key={item.id}>
              <div className="inventory-label"><span>NO. {item.number}</span><span>{item.id.toUpperCase()}</span></div>
              <img src={`/${item.id}.webp`} width="1500" height="1500" alt={item.id === "idea" ? "An interwoven silver knot" : item.id === "book" ? "A cobalt blue open-book sculpture" : "A yellow sculptural figure"} fetchPriority={item.id === "idea" ? "high" : "auto"} />
              <figcaption><Button variant="link" render={<a href="#collection" />} onClick={() => setKind(item.id)}><span>{item.id === "idea" ? "A thought worth following" : item.id === "book" ? "Something that stays with you" : "Someone who changes your view"}</span><ArrowUpRight size={14} /></Button></figcaption>
            </figure>)}</div>
            <h1 id="hero-heading">For the curious mind.</h1>
          </div>
          <div className="hero-bottom">
            <p>A home for the books, people and half-formed ideas you don’t want to lose. Collect them. Connect them. Make something of them.</p>
            <div className="hero-action"><Download /><span>Early Apple Silicon preview.<br />Unsigned and not notarized by Apple.</span></div>
          </div>
          <a className="hero-scroll" href="#collection"><span>TAKE A LOOK INSIDE</span><ArrowDown size={16} /></a>
        </section>
    </section>

    <section className="collection wrap" id="collection" aria-labelledby="collection-heading">
      <div className="section-kicker"><span>01 / A PERSONAL COLLECTION</span><span>AS PARTICULAR AS YOU ARE</span></div>
      <div className="section-heading"><h2 id="collection-heading">Not everything<br />is just a note.</h2><p>A book has an author. A person has a story. An idea has somewhere to go.<br /><br />In LeadingLight, each note is an object with its own type and properties. A little structure for everything that interests you.</p></div>
      <Tabs value={kind} onValueChange={(value) => setKind(value as Kind)} className="collection-tabs">
        <div className="specimen-menu"><TabsList variant="underline" aria-label="Explore example note types" className="specimen-tabs">{kinds.map((item) => <TabsTab value={item.id} key={item.id}><span>{item.number}</span>{item.label}<ArrowUpRight size={15} /></TabsTab>)}</TabsList><span className="try-label">CHOOSE AN OBJECT <ArrowDown size={13} /></span></div>
        {kinds.map((item) => <TabsPanel value={item.id} key={item.id}><Specimen kind={item.id} onSelect={setKind} /></TabsPanel>)}
      </Tabs>
      <div className="collection-caption"><p aria-live="polite">{kinds.find((item) => item.id === kind)!.description}</p><span><Link2 size={14} /> Follow the underlined links. See what connects.</span></div>
    </section>

    <section className="details wrap" id="details" aria-labelledby="details-heading">
      <div className="section-kicker"><span>02 / ROOM TO THINK</span><span>FROM A PASSING THOUGHT TO A FINISHED PIECE</span></div>
      <div className="details-heading"><h2 id="details-heading">Keep the spark.<br />Follow the thread.</h2><span className="large-asterisk" aria-hidden="true"><Sun strokeWidth={1.2} /></span></div>
      <div className="feature-row">
        <span className="feature-number">01</span><div><h3>Catch the small things.</h3><p>A sentence on your way out. Something from today. Quick capture and daily notes give passing thoughts a place to land.</p></div><div className="capture-illustration" aria-label="Quick capture shortcut: Control Option I"><span>A THOUGHT WORTH KEEPING</span><div><span>What if I looked a little closer?</span><span className="illustration-caret" /></div><div className="shortcut"><kbd>⌃</kbd><kbd>⌥</kbd><kbd>I</kbd><span>QUICK CAPTURE</span></div></div>
      </div>
      <div className="feature-row">
        <span className="feature-number">02</span><div><h3>Make room for the long ones.</h3><p>Write in blocks. Keep a source beside your draft. Leave a sidenote without losing your place in the sentence.</p></div><div className="writing-illustration" aria-label="Illustration of a draft with a sidenote"><div><FileText size={15} /><span>On paying attention</span></div><p>Start with what’s in front of you.<span className="margin-mark">1</span><br /><span className="faded">There may be more here than you think.</span></p><aside><span>1</span>Come back to this.</aside></div>
      </div>
      <div className="feature-row">
        <span className="feature-number">03</span><div><h3>Let one thing lead to another.</h3><p>Link a person to a book. A book to an idea. Backlinks help you find the way back, even when your collection grows.</p></div><div className="connection-illustration" aria-label="A book linked to an idea"><span><BookOpen size={16} />Ways of Seeing</span><div className="connection-line"><ArrowRight size={14} /></div><span><Lightbulb size={16} />The art of noticing</span></div>
      </div>
    </section>

    <section className="local-section" aria-labelledby="local-heading"><div className="wrap local-inner"><div className="local-label"><LockKeyhole size={19} /><span>03 / YOURS TO KEEP</span></div><h2 id="local-heading">A private<br />little universe.</h2><div className="local-description"><p>Your notes live on your Mac.<br />Your collection grows around you.</p><span>LeadingLight is local-first and open source. Built for the things you’re still figuring out.</span><a href={REPOSITORY} target="_blank" rel="noreferrer">Look under the hood <ArrowUpRight size={16} /></a></div><div className="local-stamp"><Circle size={18} /><span>ON YOUR DEVICE<br />IN YOUR HANDS</span></div></div></section>

    <section className="questions wrap" aria-label="A few useful details"><span className="section-kicker">A FEW USEFUL DETAILS</span><Accordion className="faq" multiple><AccordionItem value="preview"><AccordionTrigger>Can I try it now?</AccordionTrigger><AccordionPanel>Yes. LeadingLight is available as an early preview for Apple Silicon Macs. Expect rough edges. The current builds are unsigned and not notarized by Apple; download details are on <a href={RELEASES} target="_blank" rel="noreferrer">GitHub Releases</a>.</AccordionPanel></AccordionItem><AccordionItem value="local"><AccordionTrigger>Where do my notes live?</AccordionTrigger><AccordionPanel>Notes are stored locally on your device. Optional image search sends search terms and photo selections to a shared Unsplash service. Your note collection stays on your Mac.</AccordionPanel></AccordionItem><AccordionItem value="opensource"><AccordionTrigger>Is LeadingLight open source?</AccordionTrigger><AccordionPanel>Yes. LeadingLight’s own code is MIT licensed. You can read the source, follow its development or build it yourself on <a href={REPOSITORY} target="_blank" rel="noreferrer">GitHub</a>.</AccordionPanel></AccordionItem></Accordion></section>

    </main>
    <footer className="site-footer"><div className="wrap"><div className="footer-top"><span>YOUR COLLECTION STARTS WITH ONE THING.</span><a href="#main">BACK TO TOP <ArrowUpRight size={14} /></a></div><div className="footer-main"><h2>Stay curious.</h2><div><Download /><p>Early Apple Silicon preview.<br />Unsigned and not notarized by Apple.</p></div></div><div className="footer-bottom"><a href="#" className="wordmark"><Sun /><span>LeadingLight</span></a><span>LOCAL NOTES. OPEN POSSIBILITIES.</span><a href={REPOSITORY} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={14} /></a></div></div></footer>
  </div>;
}

createRoot(document.getElementById("root")!).render(<App />);
