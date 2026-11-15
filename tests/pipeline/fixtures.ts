import type { ApprovedCity } from "@/pipeline/types";

/** The 25 rows of the Airtable `Approved Cities` table (read on 2026-11-15). */
export const CITIES: ApprovedCity[] = [
  ["Netanya", "נתניה"], ["Rehovot", "רחובות"], ["Rishon LeZion", "ראשון לציון"], ["Raanana", "רעננה"],
  ["Kiryat Malakhi", "קריית מלאכי"], ["Ramla", "רמלה"], ["Ashdod", "אשדוד"], ["Givatayim", "גבעתיים"],
  ["Bnei Brak", "בני ברק"], ["Ramat Gan", "רמת גן"], ["Gedera", "גדרה"], ["Kfar Saba", "כפר סבא"],
  ["Holon", "חולון"], ["Ashkelon", "אשקלון"], ["Yavne", "יבנה"], ["Modiin", "מודיעין"],
  ["Beer Sheva", "באר שבע"], ["Lod", "לוד"], ["Herzliya", "הרצליה"], ["Tel Aviv-Yafo", "תל אביב-יפו"],
  ["Ness Ziona", "נס ציונה"], ["Sderot", "שדרות"], ["Petah Tikva", "פתח תקווה"], ["Bat Yam", "בת ים"],
  ["Kiryat Gat", "קריית גת"],
].map(([city, hebrewName]) => ({ city, hebrewName, active: true }));
