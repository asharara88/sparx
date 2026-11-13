import type { Metadata } from "next";
import Link from "next/link";
import { Mark, Name, NameArabic } from "@/components/Brand";
import { HashSession } from "@/components/HashSession";

/**
 * The front door for someone who is not in a home yet (Mido, 10 November: "a good landing
 * page to get a full view on the product"). Signed-out visits to elnunu.com land here
 * (proxy.ts); a family member whose session ran out taps Sign in at the top.
 *
 * Static, no data: the pictures are real screens of the app, taken in screenshot mode on a
 * made-up family (Mia, Sara, Omar), never the live family's names. Brand and voice as in
 * docs/BRAND.md: tokens only, no exclamation marks, plain words.
 */
export const metadata: Metadata = {
  title: "elnunu: care, together",
  description: "A shared view of your baby's day. Log a feed, a nap or a diaper with one tap, ask the helper in your own words, and everyone who looks after your baby sees the same day.",
  alternates: { canonical: "/welcome" },
  openGraph: {
    title: "elnunu: care, together",
    description: "A shared view of your baby's day, on every phone in the family.",
    url: "/welcome",
    siteName: "elnunu",
    images: [{ url: "/welcome/og.png", width: 1200, height: 630, alt: "elnunu on a phone: the baby's day at a glance" }],
    type: "website",
  },
};

const SIGN_UP = "/login?mode=signup";

export default function Welcome() {
  return (
    <div className="welcome">
      {/* A sign-in link Supabase could not send to /auth/callback lands on the Site URL with the
          session in the hash; "/" now brings a signed-out visitor here, so it is picked up here too. */}
      <HashSession />
      <header className="welcome-bar">
        <Link href="/welcome" className="inline-flex min-h-[44px] items-center gap-2" aria-label="elnunu">
          <Mark size={32} />
          <Name className="text-3xl" />
        </Link>
        <Link href="/login" className="btn btn-ghost">
          Sign in
        </Link>
      </header>

      <main>
        <section className="welcome-hero">
          <div className="welcome-copy">
            <p className="tagline text-xl">Care, together.</p>
            <h1 className="welcome-title">Your baby&apos;s day, shared with everyone who looks after them.</h1>
            <p className="welcome-lead">
              Log a feed, a nap or a diaper with one tap. Parents, grandparents and the nanny see the same day on their own phones, so nobody has to ask &ldquo;when did the baby last eat?&rdquo;
            </p>
            <div className="welcome-actions">
              <Link href={SIGN_UP} className="btn btn-primary btn-lg">
                Start your family&apos;s home
              </Link>
              <Link href="/login" className="btn btn-secondary btn-lg">
                Sign in
              </Link>
            </div>
            <p className="muted text-sm">Works on any phone, in the browser. Add it to your home screen like an app.</p>
          </div>
          <Phone src="/welcome/home.webp" alt="Home: Mia asleep for 26 minutes, today's wake-up, naps, feeds and diapers, and the four log buttons" priority />
        </section>

        <Feature
          tint="sleep"
          kicker="One tap"
          title="Log it with the baby in your other arm"
          image={{ src: "/welcome/sleep.webp", alt: "Sleep: one big button to say she woke up, today's naps on a bar from midnight to midnight, and last night's sleep" }}
        >
          <p>Start a feed or a nap with one tap and stop it with another. Forgot to press it? Say when it happened instead.</p>
          <p>No signal in the nursery? It saves on the phone and sends when you are back online.</p>
        </Feature>

        <Feature tint="guide" kicker="The helper" title="Just say it" flip visual={<Chat />}>
          <p>Type or speak the way you would to a person: &ldquo;120 ml bottle 20 min ago&rdquo;, &ldquo;wet diaper&rdquo;, &ldquo;she woke up at 6:40&rdquo;. The everyday ones are saved at once, with Undo.</p>
          <p>Ask &ldquo;how did she sleep last night?&rdquo; or &ldquo;who&apos;s home on Thursday?&rdquo;. Every answer links to the entry it came from. In English, Arabic or Russian.</p>
        </Feature>

        <Feature
          tint="feed"
          kicker="At a glance"
          title="Know what's next, not just what happened"
          image={{ src: "/welcome/day.webp", alt: "Mia's day: sleep, breastfeeds, bottles and diapers in four tiles, and today's sleep on one bar" }}
        >
          <p>Today in four numbers, the week in seven columns, and the next nap window worked out from her own rhythm and her age.</p>
          <p>Gentle tips when something looks off, one at a time, and a plain list of when to call the doctor.</p>
        </Feature>

        <Feature
          tint="milk"
          kicker="Milk"
          title="The fridge and freezer, counted for you"
          flip
          image={{ src: "/welcome/milk.webp", alt: "Milk: two bottles in the fridge, two in the freezer, how long it will last, and today's pumping against the goal" }}
        >
          <p>Every bottle put away is counted, oldest first, with how many days it has left. A bottle given comes out of the right place on its own.</p>
          <p>Pumping has a daily goal, and the stash tells you how long it will last.</p>
        </Feature>

        <Feature
          tint="pump"
          kicker="For the grown-ups"
          title="A little motivation on the hard days"
          image={{ src: "/welcome/badges.webp", alt: "Achievements: medals for pumping goals met in a row, goals beaten, and a growing freezer stash" }}
        >
          <p>Medals for pumping goals met and beaten, and for a freezer stash that grows. They are for the people doing the work, never for the baby&apos;s numbers.</p>
        </Feature>

        <Feature
          tint="sleep"
          kicker="At 3 am"
          title="Made for one hand in the dark"
          flip
          image={{ src: "/welcome/home-dark.webp", alt: "Home in the night theme: dark plum, large text and the same four log buttons" }}
        >
          <p>A dark, gentle screen at night, big buttons where the thumb already is, and nothing to read that you do not need.</p>
          <p>A simple mode with large text for grandparents who just want the one button.</p>
        </Feature>

        <section className="welcome-section">
          <p className="welcome-kicker">Everyone on the same page</p>
          <h2 className="welcome-h2">Invite the family with a link</h2>
          <ul className="welcome-roles">
            <Role tint="feed" who="Parents" what="See and change everything, invite people and choose what each one can do." />
            <Role tint="guide" who="Family" what="Grandparents and relatives log, read the day and use the calendar and chat." />
            <Role tint="milk" who="The nanny or helper" what="Clocks in and out, and sees today&apos;s calendar and the family chat, in their own language." />
          </ul>
          <p className="muted mt-3">One tap shows who has the baby right now, and who is home today.</p>
        </section>

        <section className="welcome-section">
          <p className="welcome-kicker">Grows with your baby</p>
          <h2 className="welcome-h2">From the first night to the first steps</h2>
          <ul className="welcome-list">
            <li>Vaccines on the schedule, with what is due next</li>
            <li>Meals and new foods from six months, allergens noted</li>
            <li>Milestones with photos, and a story of each month</li>
            <li>Medicine with doses and the gap before the next one</li>
            <li>The emergency number one tap away</li>
          </ul>
        </section>

        <section className="welcome-section">
          <p className="welcome-kicker">Private</p>
          <h2 className="welcome-h2">Your family&apos;s day stays in your family</h2>
          <p>Only the people you invite can see your home, and every home is kept apart from every other. No ads, and your home is never shown to search engines.</p>
        </section>

        <section className="welcome-cta">
          <Mark size={56} />
          <h2 className="welcome-h2">Care, together.</h2>
          <p>Set up your home in a minute, then invite the people who help.</p>
          <div className="welcome-actions justify-center">
            <Link href={SIGN_UP} className="btn btn-primary btn-lg">
              Start your family&apos;s home
            </Link>
            <Link href="/login" className="btn btn-secondary btn-lg">
              Sign in
            </Link>
          </div>
        </section>
      </main>

      <footer className="welcome-footer">
        <span className="inline-flex items-baseline gap-3">
          <Name className="text-2xl" />
          <NameArabic className="text-2xl" />
        </span>
        <span className="muted text-sm">A shared view of your baby&apos;s day.</span>
      </footer>
    </div>
  );
}

function Phone({ src, alt, priority = false }: { src: string; alt: string; priority?: boolean }) {
  return (
    <figure className="phone">
      {/* Plain img: the pictures are already small, and next/image would add a server step. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} width={600} height={1298} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" />
    </figure>
  );
}

function Feature({ tint, kicker, title, children, image, visual, flip = false }: { tint: string; kicker: string; title: string; children: React.ReactNode; image?: { src: string; alt: string }; visual?: React.ReactNode; flip?: boolean }) {
  return (
    <section className={`welcome-feature ${flip ? "welcome-flip" : ""}`} style={{ "--tint": `var(--${tint})`, "--tint-fg": `var(--${tint}-fg)` } as React.CSSProperties}>
      <div className="welcome-copy">
        <p className="welcome-kicker welcome-kicker-tint">{kicker}</p>
        <h2 className="welcome-h2">{title}</h2>
        <div className="welcome-body">{children}</div>
      </div>
      <div className="welcome-visual">{image ? <Phone src={image.src} alt={image.alt} /> : visual}</div>
    </section>
  );
}

/** How talking to the helper looks: the two everyday kinds of message, drawn rather than shot. */
function Chat() {
  return (
    <div className="chat-demo" role="img" aria-label="A chat with the helper: a bottle said in plain words is saved at once with Undo, and a question gets a short answer">
      <p className="bubble bubble-me">120 ml bottle 20 min ago</p>
      <div className="bubble bubble-them">
        <p className="font-semibold">Bottle 120 ml · 14:14</p>
        <p>Saved.</p>
        <span className="chip-demo">Undo</span>
      </div>
      <p className="bubble bubble-me">How did she sleep last night?</p>
      <p className="bubble bubble-them">9 h 50 min, longest stretch 5 h 5 min. Three night feeds, no other wake-ups.</p>
    </div>
  );
}

function Role({ tint, who, what }: { tint: string; who: string; what: string }) {
  return (
    <li className="welcome-role" style={{ "--tint": `var(--${tint})`, "--tint-fg": `var(--${tint}-fg)` } as React.CSSProperties}>
      <span className="welcome-role-who">{who}</span>
      <span className="welcome-role-what">{what}</span>
    </li>
  );
}
