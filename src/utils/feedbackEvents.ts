// Events and tours that the public feedback form (/feedback) knows about.
//
// Add a new entry here for each event, then share its link:
//   https://compostmonitor.netlify.app/feedback/<id>                  → date prefilled from the event
//   https://compostmonitor.netlify.app/feedback/<id>?session=morning  → also pre-ticks that session
//   https://compostmonitor.netlify.app/feedback?date=2026-11-20       → any date (e.g. a site tour)
//   https://compostmonitor.netlify.app/feedback                       → asks "did you attend today?"
//
// When someone opens the plain link, the date they confirm is matched against these events, so a
// QR code on the day picks up the right event automatically.

export interface FeedbackSession {
  key: string;     // short code for ?session=
  label: string;
}

export interface FeedbackEvent {
  id: string;
  title: string;
  venue?: string;
  date?: string;   // YYYY-MM-DD; omitted for the general "tour or visit" entry
  sessions: FeedbackSession[];
}

export const FEEDBACK_EVENTS: FeedbackEvent[] = [
  {
    id: 'living-soil-2026',
    title: 'From Food Scraps to Living Soil',
    venue: 'Eudaimonia',
    date: '2026-11-09',
    sessions: [
      { key: 'morning', label: 'Compost Nerd-Out: The Science of Green Loop (morning)' },
      { key: 'afternoon', label: 'Food Scraps to Living Soil: In the Green Loop (afternoon)' },
    ],
  },
];

/** Used when no event matches the date: a site tour, school visit, talk, etc. */
export const GENERAL_VISIT: FeedbackEvent = {
  id: 'tour-or-visit',
  title: 'Green Loop tour or visit',
  sessions: [
    { key: 'tour', label: 'Site tour of the composting operation' },
    { key: 'talk', label: 'Talk or presentation' },
    { key: 'workshop', label: 'Workshop or hands-on session' },
    { key: 'other', label: 'Other' },
  ],
};

export function findEventById(id: string | undefined): FeedbackEvent | undefined {
  if (!id) return undefined;
  if (id === GENERAL_VISIT.id) return GENERAL_VISIT;
  return FEEDBACK_EVENTS.find(e => e.id === id);
}

export function findEventByDate(date: string): FeedbackEvent | undefined {
  return FEEDBACK_EVENTS.find(e => e.date === date);
}
