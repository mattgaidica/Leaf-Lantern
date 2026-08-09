/** Counter menu — single source of truth for concept-site pricing. */
export const counterMenu = [
  { item: 'Fresh Donut', detail: 'Single, warm from the line', price: '$3' },
  { item: 'Donuts · half-dozen', detail: 'Plain or cinnamon sugar', price: '$15' },
  { item: 'Donuts · dozen', detail: 'Plain, cinnamon, or mixed', price: '$26' },
  { item: 'Cider · cup', detail: 'Hot or cold', price: '$4' },
  { item: 'Cider · half-gallon', detail: 'The take-home favorite', price: '$12' },
  { item: 'Cider · gallon', detail: 'For the whole table', price: '$20' },
  { item: 'Morning Cup', detail: 'Locally roasted. Simple, hot, honest — or kids’ mini cider', price: '$2' },
  { item: 'Double espresso', detail: 'Pulled behind the counter', price: '$3.75' },
  { item: 'Americano', detail: 'No size ladder, no syrup matrix', price: '$3.50' },
  { item: 'Hot chocolate', detail: 'One size, made properly', price: '$4' },
  { item: 'Dog donut', detail: 'Dog-safe, made for the good ones', price: '$2' },
  { item: 'Bundle · half-dozen + two drinks', detail: 'The courtyard visit', price: '$18' },
  { item: 'Bundle · dozen + half-gallon', detail: 'The fifteen-minute stop', price: '$35' },
  { item: 'Family package · dozen + gallon + coffee', detail: 'The table for four', price: '$48' },
] as const;

/** Program and experience pricing — lives in the business plan only. */
export const programPricing = [
  { stream: 'General admission, every day — grounds, market, café, pumpkins', price: 'Free' },
  { stream: 'Spring or summer discovery day', price: '$8–$12 per guest' },
  { stream: 'Halloween costume party or lantern evening', price: '$14–$20' },
  { stream: 'School field trip', price: '$12–$16 per student' },
  { stream: 'Summer science camp', price: '$285–$425 per child/week' },
  { stream: 'Adult or family workshop (wreath building, garden, craft)', price: '$35–$85' },
  { stream: 'Maker market booth', price: '$90–$350 (underwrite ~$100–120/day initially)' },
  { stream: 'Half-day or full-day corporate retreat package', price: '$70–$140 per attendee' },
  { stream: 'Standardized private gathering (fixed block & food package)', price: 'Package pricing; attendance-capped' },
] as const;

/** Fixed booking architecture shared by the plan and retreat page. */
export const retreatPackages = [
  {
    name: 'Half-Day Retreat',
    price: '$2,500–$3,500',
    detail: 'Up to four hours',
    copy: 'Meeting room, coffee, donuts or pastries, cider or seasonal beverages, and basic audiovisual. Optional boxed lunch through an approved partner.',
  },
  {
    name: 'Full-Day Retreat',
    price: '$3,500–$5,500',
    detail: 'Up to eight hours',
    copy: 'Exclusive or semi-exclusive meeting space, morning food, snacks and drinks through the day, basic audiovisual, and optional outdoor breakout. Lunch may come from an approved partner.',
  },
  {
    name: 'Private Gathering',
    price: '$1,500–$3,000',
    detail: 'Fixed time block',
    copy: 'Birthdays, showers, family celebrations, club meetings, and small professional receptions with predetermined layouts, attendance limits, food packages, and closing time.',
  },
] as const;
