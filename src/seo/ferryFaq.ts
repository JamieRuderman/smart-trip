import {
  weekdayFerries,
  weekendFerries,
  weekdayInboundFerries,
  weekendInboundFerries,
} from "@/data/generated/ferrySchedule.generated";
import { FERRY_CONSTANTS, FERRY_FARES } from "@/lib/fareConstants";
import { parseTimeToMinutes } from "@/lib/timeUtils";
import type { Lang } from "./constants";
import { translator } from "./i18n";

function typicalCrossingMinutes(): number {
  const counts = new Map<number, number>();
  for (const { depart, arrive } of [
    ...weekdayFerries,
    ...weekendFerries,
    ...weekdayInboundFerries,
    ...weekendInboundFerries,
  ]) {
    const minutes = parseTimeToMinutes(arrive) - parseTimeToMinutes(depart);
    counts.set(minutes, (counts.get(minutes) ?? 0) + 1);
  }
  return [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
}

/** The ferry page's FAQ, shared with its FAQPage JSON-LD so the two always match. */
export function ferryFaq(lang: Lang): { question: string; answer: string }[] {
  const t = translator(lang);
  return [
    {
      question: t("seo.ferry.faq.cost.q"),
      answer: t("seo.ferry.faq.cost.a", {
        adult: FERRY_FARES.adult.toFixed(2),
        ticket: FERRY_CONSTANTS.ADULT_PAPER_TICKET_FARE.toFixed(2),
        reduced: FERRY_FARES.youth.toFixed(2),
      }),
    },
    {
      question: t("seo.ferry.faq.smart.q"),
      answer: t("seo.ferry.faq.smart.a", { minutes: typicalCrossingMinutes() }),
    },
  ];
}
