import type { SeasonKey } from '../lib/site';

export interface LLEvent {
  slug: string;
  title: string;
  season: SeasonKey;
  dateLabel: string;
  timeLabel: string;
  price: string;
  blurb: string;
  image: string;
  imageAlt: string;
  status: 'on-sale' | 'nearly-full' | 'free';
}

export const EVENTS: LLEvent[] = [
  {
    slug: 'harvest-weekend',
    title: 'Harvest Weekend',
    season: 'autumn',
    dateLabel: 'Sat–Sun, Oct 3–4',
    timeLabel: '9 a.m. – 7 p.m.',
    price: 'Free admission · reserve a free arrival window on peak weekends',
    blurb:
      'The season we wait for all year: fresh cider, hot donuts, pumpkin selection, the harvest market, and family photo areas.',
    image: '/images/pumpkin-family.jpg',
    imageAlt: 'A family choosing a pumpkin beside the cider and donut counter',
    status: 'free',
  },
  {
    slug: 'lantern-evening',
    title: 'Lantern Evening',
    season: 'autumn',
    dateLabel: 'Fri, Oct 16',
    timeLabel: '6 – 9 p.m.',
    price: '$18 · timed entry',
    blurb:
      'A quiet, glowing evening in the courtyard — warm drinks, music, lantern light, and the grounds after dark.',
    image: '/images/lantern-evening.png',
    imageAlt: 'Guests at wood tables in the courtyard outside the Leaf & Lantern main hall',
    status: 'nearly-full',
  },
  {
    slug: 'halloween-costume-party',
    title: 'Family Halloween Costume Party',
    season: 'autumn',
    dateLabel: 'Sat, Oct 31',
    timeLabel: '4 – 8 p.m.',
    price: '$16 · timed entry',
    blurb:
      'Costumes, face painting, pumpkin games, hay bales, crafts, and a family parade — festive, never frightening.',
    image: '/images/halloween-courtyard.jpg',
    imageAlt: 'Children in homemade costumes in the lantern-lit courtyard',
    status: 'on-sale',
  },
  {
    slug: 'winter-gift-market',
    title: 'Winter Gift Market',
    season: 'holiday',
    dateLabel: 'Weekends, Nov 27 – Dec 20',
    timeLabel: '10 a.m. – 7 p.m.',
    price: 'Free admission',
    blurb:
      'Our strongest market of the year: ceramics, wool goods, candles, woodwork, pantry gifts, wreaths, and warm drinks.',
    image: '/images/gift-market.jpg',
    imageAlt: 'Maker displays and warm lantern light inside the winter gift market',
    status: 'free',
  },
  {
    slug: 'wreath-workshop',
    title: 'Evergreen Wreath Workshop',
    season: 'holiday',
    dateLabel: 'Thu, Dec 4',
    timeLabel: '6:30 – 8:30 p.m.',
    price: '$65 · materials included',
    blurb:
      'Build a full evergreen wreath with a local florist — greens, wire, ribbon, and warm drinks provided.',
    image: '/images/holiday-workshop.png',
    imageAlt: 'Adults building evergreen wreaths at a candlelit workshop table',
    status: 'nearly-full',
  },
  {
    slug: 'spring-discovery-day',
    title: 'Family Discovery Day',
    season: 'spring',
    dateLabel: 'Sat, May 2',
    timeLabel: '9 a.m. – 2 p.m.',
    price: '$10 per guest',
    blurb:
      'Soil testing, seed starting, pollinator walks, and hands-on garden stations for curious kids and adults.',
    image: '/images/spring-discovery.png',
    imageAlt: 'Children examining seedlings and garden beds on a spring morning',
    status: 'on-sale',
  },
  {
    slug: 'summer-evening-market',
    title: 'Summer Evening Market',
    season: 'summer',
    dateLabel: 'Thursdays, Jun – Aug',
    timeLabel: '5 – 9 p.m.',
    price: 'Free admission',
    blurb:
      'Local makers, acoustic music, food, and long golden evenings in the courtyard.',
    image: '/images/summer-market-evening.png',
    imageAlt: 'An evening maker market in the courtyard with acoustic music',
    status: 'free',
  },
  {
    slug: 'morning-yoga',
    title: 'Morning Yoga in the Hall',
    season: 'summer',
    dateLabel: 'Sat mornings, Jun – Aug',
    timeLabel: '8 – 9 a.m.',
    price: '$20 drop-in · 5-class pass $85',
    blurb:
      'A calm hour in the timber hall with doors open to the gardens. All levels welcome.',
    image: '/images/yoga-morning.jpg',
    imageAlt: 'A morning yoga class inside the sunlit timber hall',
    status: 'on-sale',
  },
];
