import {
  weekdayFerries,
  weekendFerries,
  weekdayInboundFerries,
  weekendInboundFerries,
} from "@/data/generated/ferrySchedule.generated";
import { FERRY_FARE_PARAMS } from "@/lib/fareConstants";
import { calculateTimeDifference } from "@/lib/timeUtils";
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
    const minutes = calculateTimeDifference(depart, arrive);
    counts.set(minutes, (counts.get(minutes) ?? 0) + 1);
  }
  return [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
}

/** Google only honors FAQPage markup that matches the FAQ shown on the page. */
export function ferryFaq(lang: Lang): { question: string; answer: string }[] {
  const t = translator(lang);
  return [
    {
      question: t("seo.ferry.faq.cost.q"),
      answer: t("seo.ferry.faq.cost.a", FERRY_FARE_PARAMS),
    },
    {
      question: t("seo.ferry.faq.smart.q"),
      answer: t("seo.ferry.faq.smart.a", { minutes: typicalCrossingMinutes() }),
    },
  ];
}
