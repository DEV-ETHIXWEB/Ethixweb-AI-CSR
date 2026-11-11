/**
 * 2026-11-11, Akash: "add at least 50 to 100 scenarios so that it will be
 * able to detect every spam call". Shared by caller-steering.spec.ts (every
 * line checked against the detectors, free) and scripts/qa-suite.ts (whole
 * calls played against the real model).
 *
 * The first two openers are Akash's own test calls, as transcribed. The rest
 * are the kinds of business calls a plumbing company's line actually gets.
 * Each pitch is followed by a request for a person and then a push, in the
 * ways his calls pushed ("it's very important", "it's urgent").
 */
export const SPAM_OPENERS: readonly string[] = [
  "hi i'm calling from chad's associate and i was thinking that you guys have subcontractors or contractors, we act basically as a broker between you guys and those subcontractors",
  "i actually noticed that you guys are using housecall pro, so we are calling from the wonderland software company and we can help you in terms of the software side",
  "i'm just from the software company and i just wanted to introduce a good software for plumbing offices",
  "hi, this is dan with bright local, we help plumbing companies show up first on google maps",
  "we do seo for home service businesses and your website is not ranking for plumber near me",
  "hey this is megan from top rank digital, quick question about your company's online presence",
  "i'm calling from servicetitan, we noticed you might be looking at new dispatch software",
  "we offer an ai answering service so you never miss a call after hours",
  "hi, i'm with a virtual receptionist company, we answer phones for contractors",
  "this is josh calling from blue collar staffing, we place licensed plumbers with companies like yours",
  "i'm a recruiter with trade talent partners and i'd like to talk about your hiring needs",
  "we provide merchant services and can lower what you pay on card processing",
  "hi, i'm calling about business funding, you're pre-approved for up to two hundred thousand dollars",
  "this is a courtesy call about a merchant cash advance for your company",
  "we offer a business line of credit with same day approval",
  "i'm calling from fleetwise, we do gps tracking for service vans",
  "we offer fuel cards for fleet vehicles that save about twenty cents a gallon",
  "hi, we help contractors get more five star reviews automatically",
  "i'm with a reputation management platform, you have a couple of bad reviews we can help bury",
  "this is about your yelp page, we can get you more visibility",
  "we sell exclusive plumbing leads, much better than thumbtack or home advisor",
  "this is an important message about your google business listing, press 1 to speak to a specialist",
  "we are calling about your vehicle's extended warranty",
  "i'm looking for the decision maker for your marketing",
  "who handles your advertising over there",
  "who handles your payroll at the company",
  "hi, we're a private equity group looking to acquire plumbing businesses in the seattle area",
  "i represent investors who would love to buy your business",
  "we host a podcast for trades business owners and would love to feature your company",
  "congratulations, your company has been nominated for best of seattle 2026",
  "this is a quick survey about home service businesses, it'll take two minutes",
  "i'm calling from the firefighters fund to ask for a donation this year",
  "we do vehicle wraps and signage for service trucks",
  "i run a video production company and we make ads for contractors",
  "we do social media marketing for plumbers, posts and ads every week",
  "we built a chat bot for plumbing websites that books jobs for you",
  "i'm calling from call rail, we do call tracking for marketing campaigns",
  "we handle payroll and bookkeeping for small contractors",
  "you may qualify for the employee retention tax credit, up to twenty six thousand per employee",
  "we do cyber security and cloud backup for small businesses",
  "i can save your business money on energy rates by switching your electricity supplier",
  "this is about your business insurance renewal, we can beat your current rate",
  "we offer workers comp and liability insurance for contractors",
  "hi, we do equipment leasing and financing for jetters and camera rigs",
  "we offer customer financing so your customers can pay over time",
  "i'm calling from cintas about uniforms for your technicians",
  "we're a wholesale distributor of water heaters and want to be your supplier",
  "we'd like to talk to you about a partnership opportunity",
  "we're a franchise company and plumbing businesses like yours do great as franchisees",
  "we list your business in our home services directory for free",
  "hi, i wanted to talk about advertising on our radio station",
  "we sell direct mail postcards to homeowners in your area",
  "i'm calling on behalf of a print shop, we do door hangers and business cards for contractors",
  "this is linda from yellow pages online, we need to verify your business listing",
  "we help businesses like yours grow with paid ads",
  "i'm with a lead generation company, we can send you twenty new jobs a week",
  "our platform helps plumbing companies schedule and invoice in one place",
  "we noticed your website is slow on mobile, we do web site redesign",
  "we're a crm company built for the trades, can we book a quick demo",
  "i just wanted to introduce our company, we do trenchless equipment sales",
  "we provide background checks and drug testing for your employees",
  "i'm calling from a safety compliance firm about osha training for your crew",
  "this is about your domain name renewal, it's expiring this week",
  "hi, we sell cleaning services for offices",
  "we are a pest control company and we offer commercial plans for your shop",
  "i'm calling from comcast business about your phone system and internet",
  "we can upgrade your business phone system with a new voip setup",
  "we offer a free trial of our estimating app for contractors",
  "this is tom from a truck dealership, we have work vans on sale for contractors",
  "we're a subcontractor crew looking for overflow work from bigger companies like yours",
  "i'm with a labor broker, we supply helpers by the day",
  "we're a company that wants to partner with you on bathroom remodels, we send you our customers",
  "hi, i run a marketing agency and saw your ads, we can cut your cost per lead in half",
  "i'm calling from the chamber of commerce about membership for your business",
  "we're doing a trade show next month and want you to buy a booth",
  "we offer online training courses for plumbing technicians",
  "our company does solar and we'd like to partner with plumbing contractors",
  "this is a call about your business credit card processing rates",
  "i'm a consultant who helps contractors grow your business to seven figures",
  "we connect plumbing companies with property managers for a monthly fee",
];

/** How each pitch asks for a person, in turn. */
export const SPAM_ASKS: readonly string[] = [
  "can i talk to your phone",
  "can i talk to the owner please",
  "is the owner available",
  "can i speak with whoever makes the decisions there",
  "can you just connect me to the human",
  "put me through to larry please",
  "i just need two minutes with the manager",
  "can you transfer me to someone in charge",
];

/** And how they push after the first no. */
export const SPAM_PUSHES: readonly string[] = [
  "can you please please connect me because it's like very important i would say",
  "it's urgent, just connect me to a human right now",
  "i really need to talk to someone, it's important",
  "come on, just put me through, it'll only take a minute",
  "i already asked, i need to speak to a real person",
];

/** One whole spam call per opener: pitch, ask for a person, push. */
export const SPAM_CALLS: ReadonlyArray<{ id: string; turns: readonly string[] }> =
  SPAM_OPENERS.map((opener, index) => ({
    id: `spam-${String(index + 1).padStart(2, "0")}`,
    turns: [
      opener,
      SPAM_ASKS[index % SPAM_ASKS.length] as string,
      SPAM_PUSHES[index % SPAM_PUSHES.length] as string,
    ],
  }));

/**
 * Real callers who ask for a person and must still reach one. Several open
 * the way a business does ("I'm calling from ...", "we're a ..."), which is
 * exactly what the new check must not catch.
 */
export const REAL_CALLERS_WHO_WANT_A_PERSON: ReadonlyArray<{
  id: string;
  turns: readonly string[];
}> = [
  ["my water heater is leaking all over the garage, can i talk to a person"],
  ["i'm calling from my office, our toilet is overflowing, connect me to someone please"],
  ["i'm the property manager at four hundred pine street, unit three has no hot water, i need to speak with the owner"],
  ["hi, this is mike from ferguson supply about larry's parts order, can i speak to him"],
  ["i'm returning a call from larry, he left me a voicemail, can you put me through"],
  ["i'm with the city of tacoma inspection department about the permit at twelve oak street, can i talk to the owner"],
  ["i'm calling from state farm about a water damage claim for one of your customers, can i speak with a manager"],
  ["we're a general contractor and we need a plumber for a kitchen remodel, can i talk to the owner"],
  ["i'm with seattle property group, we manage forty units and need a plumber on call, can i speak to someone"],
  ["i'm calling from harborview, we have a backed up drain in our kitchen, can i talk to a person"],
  ["i'm calling on behalf of my mother, her basement is flooding, can i talk to someone"],
  ["i'm a realtor with a house closing friday and it needs a sewer scope, can i talk to the owner"],
  ["i'm calling about my invoice, i was charged twice, let me talk to a manager"],
  ["this is mike from abc electric, we're on the same job at fifty five elm with larry, i need to talk to him"],
  ["hi, i'm a journeyman plumber and i saw you're hiring, can i talk to the owner about the position"],
  ["we're a restaurant on pike street and our grease trap is backing up, can i speak to someone right now"],
  ["i'm calling from my work, my kitchen sink at home won't drain, can i speak with a real person"],
  ["your technician came out yesterday and the leak is back, i want to talk to a manager"],
  ["i found you on google, my sewer line is backed up, can i talk to a human"],
  ["this is larry's wife, can you put me through to him please"],
  ["i had an appointment this morning and nobody showed up, can i speak to someone"],
  ["we noticed water coming through the ceiling of our unit, i'm the tenant, can i talk to someone"],
  ["i'm with the hoa at lake hills, the clubhouse water heater died, can i speak to the owner"],
  ["i want a quote on replacing my water heater, can i talk to a person about pricing"],
  ["i'm calling from the school district, a pipe burst in the gym, connect me to someone now"],
].map((turns, index) => ({ id: `realcaller-${String(index + 1).padStart(2, "0")}`, turns }));
