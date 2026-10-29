import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowDownToLine, ArrowUpRight, BookOpen, CalendarDays, ChevronRight, FileText, Link2, LockKeyhole, PanelLeft, Plus, Search, Sprout, StickyNote } from 'lucide-react';
import { Button } from '@leadinglight/ui/components/button';
import { Tabs, TabsList, TabsTab, TabsPanel } from '@leadinglight/ui/components/tabs';
import './styles.css';

const RELEASES = 'https://github.com/rangrik/LeadingLight/releases';

function Download({ small = false }: { small?: boolean }) {
  return <Button render={<a href={RELEASES} />} className={`download ${small ? 'download-small' : ''}`}><ArrowDownToLine size={16} />{small ? 'Get the preview' : 'Download for Mac'}{!small && <ArrowUpRight size={16} />}</Button>;
}

function Wordmark({ footer = false }: { footer?: boolean }) {
  return <a className={`wordmark ${footer ? 'wordmark-footer' : ''}`} href="#top" aria-label="LeadingLight home"><img src="/app-icon.svg" alt="" />LeadingLight</a>;
}

function Essay({ stage }: { stage: string }) {
  return <article className="essay">
    <div className="note-kind"><FileText size={13} /> Essay</div>
    <h3>The art of<br />noticing</h3>
    <p className="essay-lede">What changes when we give something our full attention?</p>
    <div className="note-rule" />
    <p>I took the long way home today. Past the corner shop, along the canal, under the same trees I pass every morning.</p>
    <p>This time, I stopped.</p>
    <p>The things we notice become the things we think about. A small detail can open up an entirely new line of thought.</p>
    <p>Perhaps a good place to begin is <span className={stage === 'write' ? 'underlined' : 'inline-page-link'}>{stage !== 'write' && <BookOpen size={13} />}The practice of attention{stage === 'write' && <span className="margin-number">1</span>}</span>.</p>
    <div className="essay-last-line" />
    {stage === 'connect' && <div className="backlinks"><Link2 size={14} /><span>Connected to <strong>2 pages</strong></span><span>Field notes · Reading</span></div>}
  </article>;
}

function Workspace() {
  const [stage, setStage] = useState('write');
  const explanations: Record<string, string> = {
    write: 'Write in blocks. Leave a thought in the margin without breaking the flow.',
    connect: 'Link a book, a person, or another page. Backlinks keep the connection in view.',
    alongside: 'Keep a source beside your draft, with room to read and write at the same time.',
  };
  return <section className="workspace-section" id="a-closer-look" aria-labelledby="workspace-heading">
    <div className="section-topline"><span className="eyebrow">01 / A PLACE TO THINK</span><span className="tiny-note">Follow your curiosity.</span></div>
    <div className="workspace-intro"><h2 id="workspace-heading">One thing leads<br />to another.</h2><p>A passing thought becomes a note.<br />A note finds a connection.<br />And slowly, something takes shape.</p></div>
    <Tabs value={stage} onValueChange={(value) => setStage(String(value))} className="workspace-tabs">
      <TabsList className="story-tabs" variant="underline" aria-label="Explore the workspace">
        <TabsTab value="write"><span>01</span> Write</TabsTab>
        <TabsTab value="connect"><span>02</span> Connect</TabsTab>
        <TabsTab value="alongside"><span>03</span> See alongside</TabsTab>
      </TabsList>
      <div className="demo-shell">
        <div className="demo-titlebar"><div className="window-dots"><i /><i /><i /></div><span>LeadingLight</span><span className="demo-saved">Saved on this Mac</span></div>
        <div className="demo-body">
          <aside className="demo-sidebar" aria-label="Illustrative navigation">
            <div className="space-name"><span className="space-avatar">M</span> My space <PanelLeft size={15} /></div>
            <div className="sidebar-search"><Search size={14} /> Search anything</div>
            <div className="sidebar-label"><CalendarDays size={15} /> Today</div>
            <div className="sidebar-heading">MY OBJECTS <Plus size={13} /></div>
            <div className="sidebar-label"><FileText size={15} /> Notes <span>12</span></div>
            <div className="sidebar-label"><BookOpen size={15} /> Books <span>8</span></div>
            <div className="sidebar-label"><Sprout size={15} /> Ideas <span>6</span></div>
            <div className="sidebar-heading second-heading">RECENT</div>
            <div className="sidebar-label selected"><FileText size={15} /> The art of noticing</div>
            <div className="sidebar-label"><BookOpen size={15} /> The practice of attention</div>
            <div className="sidebar-label"><StickyNote size={15} /> Field notes</div>
            <div className="sidebar-bottom"><span className="local-dot" /> A little space of your own</div>
          </aside>
          {['write', 'connect', 'alongside'].map(value => <TabsPanel className={`workspace-panel panel-${value}`} value={value} key={value}>
            <div className="document-breadcrumb">Notes <ChevronRight size={13} /> The art of noticing</div>
            <div className="document-spread">
              <Essay stage={value} />
              {value === 'write' && <aside className="sidenote"><span className="sidenote-number">1</span><div><span className="tiny-note">A SIDENOTE</span><p>Come back to this. There’s something here about making space.</p><span className="sidenote-date">Today, 9:41 AM</span></div></aside>}
              {value === 'connect' && <aside className="linked-note"><div className="note-kind"><BookOpen size={13} /> Book</div><h4>The practice<br />of attention</h4><p>Notes on looking closely, staying curious, and finding the extraordinary in the everyday.</p><div className="linked-note-footer"><Link2 size={14} /> Mentioned in this essay</div></aside>}
              {value === 'alongside' && <aside className="source-note"><div className="note-kind"><BookOpen size={13} /> Book · source notes</div><h4>The practice<br />of attention</h4><div className="source-meta">Reading notes <span>In progress</span></div><p className="source-quote">“The familiar becomes interesting again when we stay with it a little longer.”</p><p className="source-detail">A reminder to look twice. What did I miss the first time?</p><div className="source-footnote">A passage from our example notebook.</div></aside>}
            </div>
          </TabsPanel>)}
        </div>
      </div>
      <div className="demo-caption"><p aria-live="polite">{explanations[stage]}</p><span>Illustrative workspace · sample content</span></div>
    </Tabs>
  </section>;
}

function App() {
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="masthead" id="top"><Wordmark /><nav aria-label="Main navigation"><a className="nav-link" href="#a-closer-look">A closer look <ArrowDown size={13} /></a><a className="nav-link philosophy-link" href="#your-space">Our point of view</a><Download small /></nav></header>
    <main id="main">
      <section className="hero" aria-labelledby="hero-heading">
        <div className="hero-copy"><p className="eyebrow"><span className="local-dot" /> LOCAL-FIRST NOTES FOR MAC</p><h1 id="hero-heading">Make room<br />for thought.</h1><p className="hero-description">For the ideas you’re following.<br />The things you’re learning.<br />The work that’s becoming yours.</p><div className="hero-actions"><Download /><span className="preview-note">Early preview for Apple Silicon<br />Unsigned &amp; not notarized by Apple</span></div></div>
        <figure className="hero-art"><img src="/reading-room.webp" width="1600" height="1333" fetchPriority="high" alt="An open green cloth-bound notebook, with two connected thoughts printed on cream pages and a green ribbon between them." /><figcaption><span>ROOM FOR A LITTLE MORE.</span><span>FIG. 01 — AN OPEN MIND</span></figcaption></figure>
        <a className="hero-scroll" href="#a-closer-look"><span>Take a look around</span><ArrowDown size={17} /></a>
      </section>
      <section className="opening-statement"><p className="eyebrow">THOUGHTS NEED SOMEWHERE TO LIVE.</p><div><h2>A book. A person.<br />A passing thought.</h2><p>LeadingLight is a local-first notes app for macOS. Give each note a type, write freely in blocks, and connect it to the rest of your world.<br /><br />A home for what catches your attention. And what you make of it.</p></div></section>
      <Workspace />
      <section className="everyday" aria-labelledby="everyday-heading">
        <div className="section-topline"><span className="eyebrow">02 / THE EVERYDAY, CONSIDERED</span><span className="tiny-note">Small things. Thought through.</span></div>
        <div className="everyday-grid"><h2 id="everyday-heading">Good thoughts<br /> keep their<br />own hours.</h2><div className="everyday-details"><article><div className="detail-number">01</div><div><h3>Catch it while it’s here.</h3><p>A global shortcut opens quick capture, wherever you are on your Mac. Give the thought a place to land, then return to your day.</p><div className="keyboard-shortcut"><kbd>⌃</kbd><kbd>⌥</kbd><kbd>I</kbd><span>One shortcut. An open page.</span></div></div></article><article><div className="detail-number">02</div><div><h3>Begin with today.</h3><p>A daily note makes room for the ordinary: a conversation, a small discovery, the first line of something bigger.</p></div></article><article><div className="detail-number">03</div><div><h3>Give your notes a shape.</h3><p>Books, people, projects, ideas. Object types bring a little structure to your collection, while links let it grow in any direction.</p></div></article></div></div>
      </section>
      <section className="ownership" id="your-space" aria-labelledby="ownership-heading"><div className="ownership-symbol"><LockKeyhole size={29} strokeWidth={1.2} /></div><p className="eyebrow">03 / A SPACE OF YOUR OWN</p><h2 id="ownership-heading">Your notes.<br />Your Mac.<br />Your pace.</h2><div className="ownership-body"><p>The best place for your thoughts is a place that feels like yours. LeadingLight keeps your notes on your device, in a local database.</p><p>Built for macOS, with a quiet writing space and an open-source foundation. Something you can settle into.</p></div><div className="ownership-footnote"><span className="local-dot" /> Notes stay on your device. Optional image search uses the shared Unsplash service.</div></section>
      <section className="closing" aria-labelledby="closing-heading"><div className="closing-top"><img src="/app-icon.svg" width="70" height="70" alt="LeadingLight app icon" /><p>A LITTLE SPACE.<br />A WORLD OF POSSIBILITIES.</p></div><h2 id="closing-heading">See where a<br />thought takes you.</h2><div className="closing-bottom"><div><Download /><p className="preview-note">Early Apple Silicon preview. Expect a few rough edges.<br />Builds are unsigned and not notarized by Apple.</p></div><a className="source-link" href="https://github.com/rangrik/LeadingLight">Made in the open <ArrowUpRight size={18} /></a></div></section>
    </main>
    <footer><Wordmark footer /><span>A place to think.</span><a href="https://github.com/rangrik/LeadingLight/releases">Release notes <ArrowUpRight size={13} /></a><a href="#top">Back to the beginning <ArrowUpRight size={13} /></a></footer>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
