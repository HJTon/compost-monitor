import { useMemo, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CalendarCheck, Check, Loader2, Star } from 'lucide-react';
import { getNZDate } from '@/utils/config';
import {
  GENERAL_VISIT, findEventByDate, findEventById, type FeedbackEvent,
} from '@/utils/feedbackEvents';

// Public feedback form for tours and events — no password. See src/utils/feedbackEvents.ts
// for the event list and the link formats that prefill the date.

const BACKGROUND = [
  'Farmer / Agricultural professional',
  'Horticulturist / Market gardener / Grower',
  'Home gardener / Lifestyle block owner',
  'Business owner / Hospitality / Food sector',
  'Researcher / Scientist',
  'Educator / Teacher',
  'Student',
  'Sustainability / Environmental / Community organisation',
  'Interested community member',
  'Other',
];

const ASPECTS = [
  "Green Loop's circular food waste model",
  'Bokashi fermentation',
  'Thermophilic composting and different composting systems',
  'Soil Food Web biology and microscopy',
  'eDNA Oxford Nanopore sequencing and microbial ecology research',
  'Compost safety, maturity and biological quality',
  'Growth trials and the application of compost to living soils',
  'Practical opportunities for businesses, farmers and communities',
  'Other',
];

const UNDERSTANDING = [
  'Yes, significantly',
  'Yes, somewhat',
  'I already had a good understanding',
  'Not particularly',
  'Unsure',
];

const EXPLORE_NEXT = [
  'Scientific research findings, including Oxford Nanopore sequencing',
  'Compost safety and biological quality',
  'Practical composting methods and troubleshooting',
  'Soil Food Web microscopy and microbial monitoring',
  'Compost application and plant growth trial results',
  'Opportunities for farmers and growers to use Green Loop compost',
  'Business participation and food waste collection',
  'Expansion of Green Loop to other farms and communities',
  'Workshops, training and citizen science activities',
  'Other',
];

const PARTICIPATION_NONE = 'Not at this stage';
const PARTICIPATION = [
  'Participating as a business generating food scraps',
  'Hosting a composting system on a farm, lifestyle block or community site',
  'Using or trialling Green Loop compost in growing systems',
  'Participating in research, monitoring or citizen science',
  'Volunteering time, skills or practical support',
  'Attending future workshops, field days or educational events',
  'Collaborating through an organisation, school or community group',
  'Receiving research findings and project updates',
  PARTICIPATION_NONE,
  'Other',
];

const RATING_LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-NZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/** Swap "Other" for "Other: <text>" so the sheet keeps what they typed next to the choice. */
function withOther(selected: string[], other: string): string[] {
  return selected.map(s => (s === 'Other' && other.trim() ? `Other: ${other.trim()}` : s));
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type DateSource = 'link' | 'today' | 'chosen';

export function FeedbackPage() {
  const { eventId } = useParams();
  const [search] = useSearchParams();
  const today = getNZDate();

  const linkEvent = findEventById(eventId);
  const linkDate = search.get('date') ?? linkEvent?.date ?? null;
  const validLinkDate = linkDate && /^\d{4}-\d{2}-\d{2}$/.test(linkDate) ? linkDate : null;

  // Date: a link date is treated as already confirmed (with a "not right?" escape);
  // otherwise the person has to say whether they attended today.
  const [attendedDate, setAttendedDate] = useState<string>(validLinkDate ?? today);
  const [dateSource, setDateSource] = useState<DateSource | null>(validLinkDate ? 'link' : null);
  const [pickingDate, setPickingDate] = useState(false);

  const event: FeedbackEvent = linkEvent ?? findEventByDate(attendedDate) ?? GENERAL_VISIT;

  const preselect = search.get('session');
  const [sessionsByEvent, setSessionsByEvent] = useState<Record<string, string[]>>(() => {
    const s = linkEvent?.sessions.find(x => x.key === preselect);
    return s && linkEvent ? { [linkEvent.id]: [s.label] } : {};
  });
  const sessions = sessionsByEvent[event.id] ?? [];
  const [sessionOther, setSessionOther] = useState('');

  const [background, setBackground] = useState<string[]>([]);
  const [backgroundOther, setBackgroundOther] = useState('');
  const [mostValuable, setMostValuable] = useState('');
  const [aspects, setAspects] = useState<string[]>([]);
  const [aspectsOther, setAspectsOther] = useState('');
  const [understanding, setUnderstanding] = useState('');
  const [rating, setRating] = useState(0);
  const [exploreNext, setExploreNext] = useState<string[]>([]);
  const [exploreOther, setExploreOther] = useState('');
  const [priority, setPriority] = useState('');
  const [participation, setParticipation] = useState<string[]>([]);
  const [participationOther, setParticipationOther] = useState('');
  const [improve, setImprove] = useState('');
  const [wantsContact, setWantsContact] = useState<boolean | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactOrg, setContactOrg] = useState('');
  const [website, setWebsite] = useState(''); // honeypot

  const [submissionId] = useState(newId);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const wantsUpdatesOrInvolvement = participation.some(p => p !== PARTICIPATION_NONE);

  const problems = useMemo(() => {
    const p: Record<string, string> = {};
    if (!dateSource) p.date = 'Please confirm the day you attended.';
    else if (attendedDate > today) p.date = "That date hasn't happened yet.";
    if (sessions.length === 0) p.sessions = 'Please choose at least one.';
    if (background.length === 0) p.background = 'Please choose at least one.';
    if (!mostValuable.trim()) p.mostValuable = 'Please share one thing — a sentence is plenty.';
    if (!understanding) p.understanding = 'Please choose one.';
    if (wantsContact === true && !/^\S+@\S+\.\S+$/.test(contactEmail.trim())) {
      p.contact = 'Please add an email address so we can reach you.';
    }
    return p;
  }, [dateSource, attendedDate, today, sessions, background, mostValuable, understanding, wantsContact, contactEmail]);

  const err = (key: string) => (showErrors ? problems[key] : undefined);

  async function submit() {
    if (Object.keys(problems).length > 0) {
      setShowErrors(true);
      const first = document.querySelector('[data-has-error="true"]');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/.netlify/functions/compost-feedback-write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: submissionId,
          eventId: event.id,
          eventTitle: event.date ? `${event.title} (${event.venue ?? ''} ${event.date})`.replace(' )', ')') : event.title,
          attendedDate,
          dateSource,
          sessions: withOther(sessions, sessionOther),
          background: withOther(background, backgroundOther),
          mostValuable,
          aspects: withOther(aspects, aspectsOther),
          understanding,
          rating: rating || null,
          exploreNext: withOther(exploreNext, exploreOther),
          priority,
          participation: withOther(participation, participationOther),
          improve,
          wantsContact: wantsContact === true,
          contactName: wantsContact ? contactName : '',
          contactEmail: wantsContact ? contactEmail : '',
          contactOrg: wantsContact ? contactOrg : '',
          website,
        }),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      setSubmitted(true);
      window.scrollTo({ top: 0 });
    } catch {
      // Same submissionId on retry, and the function skips IDs it already has — no duplicates.
      setError("We couldn't send that — please check your connection and try again. Your answers are still here.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Shell>
        <div className="bg-white rounded-2xl shadow-sm p-6 text-center space-y-3">
          <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
            <Check className="w-7 h-7 text-green-primary" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Thank you for helping us close the loop! 🌱</h2>
          <p className="text-gray-600">
            Your curiosity, questions and ideas help shape a more circular and regenerative future for Taranaki.
          </p>
        </div>
        <Footer />
      </Shell>
    );
  }

  const isSingleEvent = Boolean(event.date);

  return (
    <Shell>
      {/* Intro */}
      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
        <h1 className="text-xl font-bold text-gray-900 leading-snug">
          Green Loop – Learning, Reflections &amp; Future Opportunities 🌱
        </h1>
        <p className="text-green-dark font-medium">
          {isSingleEvent
            ? `${event.title} | ${event.venue ? `${event.venue}, ` : ''}${formatLongDate(event.date!).replace(/^\w+, /, '')}`
            : event.title}
        </p>
        <p className="text-gray-800 font-semibold">Ngā mihi nui for joining us!</p>
        <p className="text-gray-600 text-sm">
          Green Loop is a Sustainable Taranaki initiative transforming local food waste into a resource for
          regenerating Taranaki&apos;s soils. Through our collaboration with Massey University and Fuller Light
          Soils, supported by the Pivot Research-in-Action Award, we&apos;re exploring the science behind
          producing safe, biologically functional compost and how this knowledge can support our communities.
        </p>
        <p className="text-gray-600 text-sm">
          We&apos;d love to know what you learned, what sparked your curiosity and where you&apos;d like to see
          Green Loop go next. Your feedback will help us evaluate our educational outreach, guide future research
          communication and identify opportunities for collaboration.
        </p>
        <p className="text-gray-500 text-xs">
          About 3–4 minutes. Responses are anonymous unless you&apos;d like us to contact you.
        </p>
      </div>

      <Section title="1. Your Green Loop experience">
        {/* Date check */}
        <Question label="When did you attend?" required error={err('date')}>
          {dateSource && !pickingDate ? (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-green-50 border border-green-200 px-4 py-3">
              <div className="flex items-center gap-3">
                <CalendarCheck className="w-5 h-5 text-green-primary shrink-0" />
                <span className="text-gray-900 font-medium">
                  {attendedDate === today ? `Today, ${formatLongDate(attendedDate)}` : formatLongDate(attendedDate)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPickingDate(true)}
                className="text-sm text-green-dark underline shrink-0"
              >
                Not right?
              </button>
            </div>
          ) : !pickingDate ? (
            <div className="space-y-2">
              <p className="text-gray-700">Did you attend today, <strong>{formatLongDate(today)}</strong>?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setAttendedDate(today); setDateSource('today'); }}
                  className="flex-1 rounded-xl bg-green-primary text-white font-medium py-3"
                >
                  Yes, today
                </button>
                <button
                  type="button"
                  onClick={() => setPickingDate(true)}
                  className="flex-1 rounded-xl border border-gray-300 bg-white text-gray-800 font-medium py-3"
                >
                  No, another day
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-gray-700 text-sm">Which day did you attend?</p>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={attendedDate}
                  max={today}
                  onChange={e => setAttendedDate(e.target.value)}
                  className="flex-1 rounded-xl border border-gray-300 px-3 py-3 text-gray-900 bg-white"
                />
                <button
                  type="button"
                  disabled={!attendedDate}
                  onClick={() => { setDateSource('chosen'); setPickingDate(false); }}
                  className="rounded-xl bg-green-primary text-white font-medium px-5 disabled:opacity-50"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </Question>

        <Question
          label={isSingleEvent ? 'Q1. Which session did you attend?' : 'Q1. What did you take part in?'}
          hint="Select all that apply."
          required
          error={err('sessions')}
        >
          <CheckList
            options={event.sessions.map(s => s.label)}
            selected={sessions}
            onChange={v => setSessionsByEvent(prev => ({ ...prev, [event.id]: v }))}
            other={sessionOther}
            onOther={setSessionOther}
          />
        </Question>

        <Question label="Q2. Which best describes your background or interest?" hint="Select all that apply." required error={err('background')}>
          <CheckList options={BACKGROUND} selected={background} onChange={setBackground} other={backgroundOther} onOther={setBackgroundOther} />
        </Question>
      </Section>

      <Section title="2. Learning & discovery">
        <Question
          label="Q3. What was the most valuable or surprising thing you learned about Green Loop, composting or soil biology?"
          required
          error={err('mostValuable')}
        >
          <TextArea value={mostValuable} onChange={setMostValuable} />
        </Question>

        <Question label="Q4. Which aspects were most interesting or valuable to you?" hint="Select up to three.">
          <CheckList options={ASPECTS} selected={aspects} onChange={setAspects} max={3} other={aspectsOther} onOther={setAspectsOther} />
        </Question>

        <Question
          label="Q5. Did it improve your understanding of how food waste can be transformed into biologically active compost and support soil health?"
          required
          error={err('understanding')}
        >
          <RadioList options={UNDERSTANDING} value={understanding} onChange={setUnderstanding} />
        </Question>

        <Question label="Q6. Overall, how would you rate it?" hint="Optional.">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                aria-label={`${n} – ${RATING_LABELS[n]}`}
                onClick={() => setRating(n === rating ? 0 : n)}
                className="p-1"
              >
                <Star className={`w-9 h-9 ${n <= rating ? 'fill-lime-accent text-lime-dark' : 'text-gray-300'}`} />
              </button>
            ))}
            <span className="ml-2 text-sm text-gray-600">{RATING_LABELS[rating]}</span>
          </div>
        </Question>
      </Section>

      <Section title="3. Looking forward">
        <Question label="Q7. What would you most like to learn more about or see Green Loop explore next?" hint="Select up to three.">
          <CheckList options={EXPLORE_NEXT} selected={exploreNext} onChange={setExploreNext} max={3} other={exploreOther} onOther={setExploreOther} />
        </Question>

        <Question label="Q8. If you could suggest one priority for Green Loop's next stage, what would it be?" hint="Optional.">
          <TextArea value={priority} onChange={setPriority} />
        </Question>
      </Section>

      <Section title="4. Future participation">
        <Question label="Q9. Would you be interested in taking part in Green Loop or its future activities?" hint="Select all that apply.">
          <CheckList
            options={PARTICIPATION}
            selected={participation}
            onChange={setParticipation}
            exclusive={PARTICIPATION_NONE}
            other={participationOther}
            onOther={setParticipationOther}
          />
        </Question>
      </Section>

      <Section title="5. Your feedback">
        <Question label="Q10. What could we improve about the event or how the information was presented?" hint="Optional.">
          <TextArea value={improve} onChange={setImprove} />
        </Question>
      </Section>

      <Section title="6. Stay connected">
        <Question
          label="Q11. Would you like us to contact you about any opportunities you've selected?"
          error={err('contact')}
        >
          {wantsUpdatesOrInvolvement && wantsContact === null && (
            <p className="text-sm text-green-dark mb-2">
              You ticked some ways to get involved — leave your details and we&apos;ll follow up.
            </p>
          )}
          <RadioList
            options={['Yes', 'No']}
            value={wantsContact === null ? '' : wantsContact ? 'Yes' : 'No'}
            onChange={v => setWantsContact(v === 'Yes')}
          />
          {wantsContact && (
            <div className="mt-3 space-y-2">
              <TextInput label="Name" value={contactName} onChange={setContactName} autoComplete="name" />
              <TextInput label="Email" value={contactEmail} onChange={setContactEmail} type="email" autoComplete="email" />
              <TextInput label="Organisation (optional)" value={contactOrg} onChange={setContactOrg} autoComplete="organization" />
              <p className="text-xs text-gray-500">
                Your contact details are kept separately from your answers and used only to follow up on the
                interests you&apos;ve selected. They won&apos;t be included in research reporting or shared with
                research partners without your permission.
              </p>
            </div>
          )}
        </Question>
      </Section>

      {/* Honeypot — hidden from people, tempting to bots */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={website}
        onChange={e => setWebsite(e.target.value)}
        className="hidden"
        aria-hidden="true"
        name="website"
      />

      {showErrors && Object.keys(problems).length > 0 && (
        <p className="text-sm text-red-600 text-center">A few required questions still need an answer — they&apos;re marked in red above.</p>
      )}
      {error && <p className="text-sm text-red-600 text-center">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="w-full rounded-2xl bg-green-primary text-white text-lg font-semibold py-4 shadow-sm disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 className="w-5 h-5 animate-spin" />}
        {submitting ? 'Sending…' : 'Send feedback'}
      </button>

      <Footer />
    </Shell>
  );
}

// ── Layout pieces ────────────────────────────────────────────────────────────

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-green-50/50 pb-10">
      <div className="bg-green-primary text-white px-4 py-3 flex items-center gap-3">
        <img src="/green-loop-logo.jpg" alt="Green Loop" className="w-9 h-9 rounded-lg object-contain bg-white p-0.5" />
        <div>
          <p className="font-bold leading-tight">Green Loop</p>
          <p className="text-white/70 text-xs">Event &amp; tour feedback</p>
        </div>
      </div>
      <div className="max-w-xl mx-auto px-4 pt-4 space-y-4">{children}</div>
    </div>
  );
}

function Footer() {
  return (
    <p className="text-center text-xs text-gray-500 pt-2">
      Green Loop | Sustainable Taranaki | Fuller Light Soils | Massey University
    </p>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-white rounded-2xl shadow-sm p-5 space-y-6">
      <h2 className="text-sm font-bold uppercase tracking-wide text-green-dark">{title}</h2>
      {children}
    </section>
  );
}

function Question({ label, hint, required, error, children }: {
  label: string; hint?: string; required?: boolean; error?: string; children: ReactNode;
}) {
  return (
    <div data-has-error={error ? 'true' : undefined} className={error ? 'rounded-xl ring-2 ring-red-300 p-3 -m-3' : ''}>
      <p className="font-medium text-gray-900">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </p>
      {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      <div className="mt-3">{children}</div>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}

function CheckList({ options, selected, onChange, max, exclusive, other, onOther }: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  max?: number;
  exclusive?: string;      // choosing this clears the rest, and vice versa
  other?: string;
  onOther?: (v: string) => void;
}) {
  const atMax = max !== undefined && selected.length >= max;
  function toggle(opt: string) {
    if (selected.includes(opt)) return onChange(selected.filter(s => s !== opt));
    if (opt === exclusive) return onChange([opt]);
    if (atMax) return;
    onChange([...selected.filter(s => s !== exclusive), opt]);
  }
  return (
    <div className="space-y-2">
      {options.map(opt => {
        const on = selected.includes(opt);
        const disabled = !on && atMax;
        return (
          <div key={opt}>
            <button
              type="button"
              onClick={() => toggle(opt)}
              disabled={disabled}
              className={`w-full text-left flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                on ? 'border-green-primary bg-green-50' : 'border-gray-200 bg-white'
              } ${disabled ? 'opacity-40' : ''}`}
            >
              <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center ${
                on ? 'bg-green-primary border-green-primary' : 'border-gray-300'
              }`}>
                {on && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
              </span>
              <span className="text-gray-800 text-[15px] leading-snug">{opt}</span>
            </button>
            {opt === 'Other' && on && onOther && (
              <input
                type="text"
                value={other}
                onChange={e => onOther(e.target.value)}
                placeholder="Please tell us more"
                className="mt-2 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-gray-900"
              />
            )}
          </div>
        );
      })}
      {max !== undefined && (
        <p className="text-xs text-gray-500">{selected.length} of {max} chosen</p>
      )}
    </div>
  );
}

function RadioList({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      {options.map(opt => {
        const on = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`w-full text-left flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
              on ? 'border-green-primary bg-green-50' : 'border-gray-200 bg-white'
            }`}
          >
            <span className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center ${
              on ? 'border-green-primary' : 'border-gray-300'
            }`}>
              {on && <span className="w-2.5 h-2.5 rounded-full bg-green-primary" />}
            </span>
            <span className="text-gray-800 text-[15px]">{opt}</span>
          </button>
        );
      })}
    </div>
  );
}

function TextArea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={3}
      className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-gray-900"
    />
  );
}

function TextInput({ label, value, onChange, type = 'text', autoComplete }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm text-gray-700">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-gray-900"
      />
    </label>
  );
}
