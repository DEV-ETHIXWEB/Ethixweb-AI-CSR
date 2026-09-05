# Emergency Facts

All facts crawled live 2026-09-05 from allphaseplumbing.com. This is
company-published guidance for AI knowledge (what Grace can tell a
caller). It does NOT replace or change the code-level emergency
classification in `apps/core-api/src/modules/emergency-rules/` — that
system's `DEFAULT_EMERGENCY_KEYWORDS` and the `escalateEmergency` tool
decide whether to actually escalate/transfer; these facts only inform
what Grace can accurately SAY about emergencies before or after that
tool runs.

## What the company defines as an emergency

FACT: Burst/leaking pipes flooding the home; no water anywhere in the house; sewer backup into sinks/tubs/floor drains; a leaking or flooding water heater; a gas smell near plumbing fixtures; the only toilet in the home not working; frozen pipes that may burst when thawed.
SOURCE: /services/plumbing/emergency-plumber (FAQ section)
SOURCE URL: https://www.allphaseplumbing.com/services/plumbing/emergency-plumber
VERIFIED: 2026-09-05
STATUS: approved

## Customer safety instructions (non-gas emergencies)

FACT: Before a technician arrives, the company advises: shut off the main water valve to stop active flooding; turn off the water heater if it's leaking; move valuables away from the affected area; take photos for insurance documentation.
SOURCE: /services/plumbing/emergency-plumber
SOURCE URL: https://www.allphaseplumbing.com/services/plumbing/emergency-plumber
VERIFIED: 2026-09-05
STATUS: approved

## Gas leak safety — highest severity, kept as its own item

FACT: If a customer smells gas: leave the building immediately, do not operate any electrical switches, and call the gas utility's emergency line from OUTSIDE the building. Only after the gas utility has made the area safe should the customer contact All Phase Plumbing.
SOURCE: /services/plumbing/gas-line-repair
SOURCE URL: https://www.allphaseplumbing.com/services/plumbing/gas-line-repair
VERIFIED: 2026-09-05
STATUS: approved — this is the single highest-stakes fact in this whole knowledge base; kept as its own dedicated KnowledgeItem (not merged into the general emergency item) so it can't get lost/deprioritized.

FACT: Warning signs of a gas leak: sulfur/rotten-egg smell near appliances or lines, hissing sounds from gas lines, dead vegetation in a strip over a buried line, an unexplained jump in the gas bill, or headaches/dizziness/nausea indoors.
SOURCE: /services/plumbing/gas-line-repair
SOURCE URL: https://www.allphaseplumbing.com/services/plumbing/gas-line-repair
VERIFIED: 2026-09-05
STATUS: approved

## Response time

FACT: The company states most Seattle-area emergency calls are reached within 60-90 minutes; severe weather events may extend that window. This is a general expectation, not a guaranteed arrival time for a specific call — Grace must never promise a specific arrival time the system hasn't actually verified (matches the existing "never invent availability" rule already in her prompt).
SOURCE: /services/plumbing/emergency-plumber
SOURCE URL: https://www.allphaseplumbing.com/services/plumbing/emergency-plumber
VERIFIED: 2026-09-05
STATUS: approved
