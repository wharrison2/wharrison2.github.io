// Made by tools/build_content.py from content/transcription.toml: edit the text there, not here.
const S = {
 "page": {
  "title": "Transcription detector",
  "heading": "Transcription detector",
  "intro": "Type, and a model guesses whether you're writing your own words or copying someone else's, from how you type rather than what. Everything happens in your browser; nothing is sent anywhere."
 },
 "modes": {
  "label": "What to type",
  "own": "Write your own",
  "copy": "Copy a passage"
 },
 "typing": {
  "label": "Your typing",
  "placeholder": "Start typing…",
  "copy_prompt": "Type the passage below exactly as written.",
  "source": "Wikipedia",
  "new_question": "New question",
  "new_passage": "New passage",
  "words": "{n} words",
  "one_word": "1 word",
  "this_stretch": "This stretch: {count}",
  "paste_off": "Pasting is off: it has to see you type.",
  "phone_note": "This works best on a physical keyboard: phone keyboards don't report keystrokes the same way.",
  "questions": [
   "What person has most influenced your thinking, and what is your biggest disagreement with them?",
   "What's a specific item on your moral to-do list? Why haven't you gotten to it?",
   "Estimate (without looking it up) how many M&Ms could fit in an adult African elephant, and reason through your answer.",
   "What's a belief you've changed your mind about in the last few years? What finally changed it?",
   "What's something you're confident about that most people around you would disagree with?",
   "Make the strongest case you can against something you care about.",
   "Roughly how many words have you spoken in your whole life so far? Show your reasoning."
  ]
 },
 "verdict": {
  "waiting": "Waiting for typing",
  "keep_going": "Keep going",
  "needs_more": "It needs a few sentences, about 30 words, to say much.",
  "own": "Looks like your own words",
  "copied": "Looks copied",
  "unsure": "?",
  "early": "Early guess: {verdict}",
  "earlier_own": "That stretch: looks like your own words",
  "earlier_copied": "That stretch: looks copied",
  "sure": "{pct}% sure.",
  "more_reliable": "It gets more reliable around {words} words.",
  "rough": "Only {words} words, so a rough call.",
  "meter_own": "Your own",
  "meter_copied": "Copied",
  "features_heading": "What it's looking at",
  "legend_own": "Middle half of people writing their own words",
  "legend_copied": "Middle half of people copying a passage"
 },
 "features": {
  "paused": "Time spent paused",
  "runs": "Times you went back to delete",
  "runs_unit": "{n} per 100 keys",
  "run_length": "Keys deleted each time",
  "push_none": "doesn't say much either way",
  "push_copied": "points to copied",
  "push_own": "points to your own words"
 },
 "about": {
  "heading": "About",
  "body": "This is a live version of a class project (CS 129). AI-writing detectors judge text by what it says, which makes them unreliable and unfair to non-native English speakers. This one looks only at the process: the timing of your keystrokes, your pauses and your deletions.\n\nFor the study, people typed about 50 words twice: once writing freely and once copying a Wikipedia passage, in random order. A logistic regression on three features of their keystroke logs (time spent paused, how often they went back to delete, and how much they deleted each time) tells the two apart {accuracy} of the time on held-out typing. People writing their own words pause to think and go back to fix things; people copying type in long, steady bursts. Most of its mistakes are calling rushed, careless writing copied.\n\n[Code on GitHub](https://github.com/wharrison2/Transcription-Detector-Keystroke-Logger)\n",
  "accuracy": "about {pct}%"
 },
 "passages": [
  {
   "text": "Tower 333 is a 20-story high-rise office building in the central business district of Bellevue, Washington, United States. The building housed the corporate office of Expedia, Inc. from 2008 to 2019. Amazon is planned to take over the lease for the entire building in 2020.",
   "url": "https://en.wikipedia.org/wiki/Tower_333"
  },
  {
   "text": "Shopper's World is an open-air shopping center in Framingham, Massachusetts. The original facility (spelled Shoppers' World) is of historical significance as one of the first suburban shopping malls in the United States upon opening in 1951; though it had a central courtyard and covered walkways, it was not fully indoor.",
   "url": "https://en.wikipedia.org/wiki/Shopper%27s_World"
  },
  {
   "text": "The National Museum of Galle (Galle National Museum) is one of the national museums of Sri Lanka. It is located in the oldest remaining Dutch building in the Galle fort, Galle, a single storey colonnaded Dutch building built in 1656 as the commissariat store for the Dutch garrison at the fort.",
   "url": "https://en.wikipedia.org/wiki/National_Museum_of_Galle"
  },
  {
   "text": "The 1954 Atlantic hurricane season was an above-average Atlantic hurricane season in terms of named storms, with 16 forming. Overall, the season resulted in $751.6 million in damage, the most of any season at the time. The season officially began on June 15, and nine days later the first named storm developed.",
   "url": "https://en.wikipedia.org/wiki/1954_Atlantic_hurricane_season"
  },
  {
   "text": "The men's singles was a tennis event held as part of the tennis program at the 1904 Summer Olympics. It was the third time the event was held at the Olympics. There were 27 competitors from 2 nations. The event was won by Beals Wright, with the Americans sweeping the medals.",
   "url": "https://en.wikipedia.org/wiki/Tennis_at_the_1904_Summer_Olympics_%E2%80%93_Men%27s_singles"
  }
 ]
};
export default S;
// Fills in the {names} in a string: fill(S.some.key, { name: value }).
export const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
