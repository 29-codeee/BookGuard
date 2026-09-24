# BookGuard travel reference data

These files power the searchable Data Library and are imported at backend startup into `travel_reference_data`. They are static reference records, not live inventory; the app does not book these providers or verify current availability.

| Category | Source | Imported coverage | Limits |
|---|---|---|---|
| Hotels | [Goa Hotels (Kaggle, CC0)](https://www.kaggle.com/datasets/viveknakrani/goa-hotels-dataset) | Goa hotel snapshot (`goa-hotels-source/hotels_cleaned.csv`) | Historic snapshot; source does not specify price currency. |
| Stays | Same Goa hotel source plus the Airbnb source below | Goa hotel stays and global Airbnb sample rows | This is a broad discovery category, not a separate live homestay feed. |
| Airbnb | [Airbnb Listing Data for Data Science (Kaggle, CC0)](https://www.kaggle.com/datasets/joyshil0599/airbnb-listing-data-for-data-science) | 1,513 global sample listings across 3 CSVs | No India listings were present in the imported files; snapshot prices are not current quotes. |
| Buses | [OpenCity Public Transport Accessibility (public domain)](https://data.opencity.in/dataset/public-transport-data/resource/f482bef5-e59d-4e79-99d9-bf5d643f9b2a) | 74 city/AC-type bus capacity records | Counts of buses, terminals, stands, and stops; no routes, schedules, fares, or booking availability. |
| Trains | [Indian Railways Dataset (Kaggle, CC0)](https://www.kaggle.com/sripaadsrinivasan/indian-railways-dataset/metadata) | 5,208 route/schedule records | Historical schedule snapshot; confirm current service with railway operator before travel. |
| Flights | [Flights in India (Kaggle, CC0)](https://www.kaggle.com/datasets/dhairya903/flights-in-india/versions/1) | 2,907 historic fare observations from February 2022 | Historical research only; not a current price API or bookable offer. |

All categories are labelled in the UI as reference-only and not bookable. Do not present the snapshot values as current prices or availability.
