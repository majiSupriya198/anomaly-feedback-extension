# Managed feedback list (generalized)

Config version **1.1.0**. 58 live entries. Source: the generalized feedback sheet, applied with `npm run import:generalized`. IDs are stable. Merged and removed entries stay in `config/feedback.json` as soft-deleted records pointing at their canonical entry (`mergedInto`).

| ID | Used | Categories | Feedback text |
|---|---|---|---|
| fb-007 | 30 | extract.promotionText | Shipping, delivery and other logistical offers (for example free shipping) must not be extracted as promotionText. |
| fb-001 | 27 | extract.outOfStock | Product is not out of stock when at least one fulfillment option (for example pickup or delivery) is available. |
| fb-002 | 26 | extract.promotionText | Site-wide or retailer-level offers (for example banners, website-exclusive offers or app offers) are not specific to the main product and must not be extracted as promotionText. |
| fb-003 | 18 | extract.bulletPoints | Bullet markers or separators (plain-text paragraph, decorative symbols) are not preserved during extraction, so individual bullet points cannot be reliably extracted. This is a known limitation. |
| fb-009 | 17 | extract.promotionText | Sign-up, registration or new-customer offers are retailer-level and must not be extracted as promotionText. |
| fb-011 | 16 | extract.promotionText | Membership, club and loyalty-program benefits or sign-ups are not product-specific promotions and must not be extracted as promotionText. |
| fb-006 | 15 | extract.promotionText | Price display and price-qualifier text (for example current price, VAT-inclusive price, loyalty-conditioned price or price-availability messages) that states no discount or offer must not be extracted as promotionText. |
| fb-004 | 13 | extract.ingredients | The extracted value is correct and comes from the main product's ingredients section; the deterministic comparison mismatches because the DOM contains repeated or additional content, so this is not a true anomaly. |
| fb-005 | 12 | extract.ingredients | Ingredients that are visible only in an image are not directly extractable text and must not be extracted as ingredients. |
| fb-008 | 12 | extract.promotionText | Cart-level savings and subscribe-related pricing or discounts must not be extracted as promotionText. |
| fb-012 | 9 | extract.promotionText | Payment, financing, installment and credit card offers are not product promotions and must not be extracted as promotionText. |
| fb-014 | 9 | feedback.commentCount | The extracted comment count is correct for the current product; the validation referenced a different product's or an outdated value, so this is not an extraction issue. |
| fb-013 | 7 | extract.price | A price that belongs to a different variant, not the currently selected one, must not be extracted as the main product price. |
| fb-025 | 7 | extract.promotionText | Conditional offers that require purchasing additional items, services or multiple products must not be extracted as promotionText. |
| fb-029 | 7 | extract.manufacturer | Names that appear only as contact, returns or EU Responsible Person details are not explicitly identified as the product's manufacturer and must not be extracted as manufacturer. |
| fb-015 | 6 | extract.price | The extracted price is correct for the current product; the validation referenced a price from a different product, so this is not an extraction issue. |
| fb-016 | 6 | extract.description | The value is present and has been successfully extracted from the product page. The DOM contains repeated product content, which can cause a difference between the DOM value and the extracted value. Therefore, this should not be considered a true anomaly. |
| fb-017 | 6 | extract.sponsored | A localized sponsored label (for example the German word for 'Sponsored') present in the HTML and rendered page is a valid non-null value. |
| fb-020 | 6 | extract.hasRichContent | Informational or editorial content (for example buying guides, reviews or a nutrition label image) is not rich content for the main product. |
| fb-019 | 5 | extract.groupId | In the retailer rules flow, extract groupId only for products with variants; do not extract it for single products. |
| fb-033 | 5 | extract.manufacturer | Brand, commercial brand or trademark information is not manufacturer information and must not be extracted as manufacturer unless a separate manufacturer is explicitly specified. |
| fb-021 | 4 | feedback.avgRating | The extracted average rating is correct for the current product; the validation referenced a different product's value, so this is not an extraction issue. |
| fb-022 | 4 | extract.promotionText | Purchase limit notices are not promotions and must not be extracted as promotionText. |
| fb-023 | 4 | extract.promotionText | A promotion that belongs to a different product must not be extracted as the main product's promotionText. |
| fb-035 | 4 | extract.imageUrl | The visible image count on the screenshot must not be used alone to validate or null the extracted image URLs, for example when the page has loading issues. |
| fb-080 | 4 | extract.promotionText | Competition, sweepstakes and ticket campaigns are not product promotions and must not be extracted as promotionText. |
| fb-027 | 3 | extract.imageUrl | Images that are hidden until a user interaction (for example a click) are still part of the product's image set and are valid extractions. |
| fb-028 | 3 | extract.name | A product name from a hidden or background listing, while the page shows a product-unavailable popup, does not represent the displayed main product. |
| fb-053 | 3 | extract.ingredients | Ingredients must not be extracted from the product description or claims when there is no ingredients-specific section or label. |
| fb-070 | 3 | extract.description | Description must be extracted only from the dedicated Description section, not from other sections such as Highlights, Product information or Brand information. |
| fb-089 | 3 | extract.netQuantity | Pack size and item-count fields (for example number of packs or rolls) indicate quantity of items, not net quantity, and must not be extracted as netQuantity. |
| fb-036 | 2 | extract.pricePerUnit | A pricePerUnit value that belongs to an unselected variant, not the currently selected variant, must not be extracted. |
| fb-037 | 2 | extract.instructions | Usage instructions that appear only in an image are not directly extractable text and must not be extracted as instructions. |
| fb-038 | 2 | extract.instructions | Instructions must not be extracted from general description text without a dedicated Instructions, Directions or Usage section or label. |
| fb-042 | 2 | extract.promotionText | Generic marketing text without a concrete offer value (such as a currency amount, percentage, multi-buy, bundle or coupon) is not valid promotionText. |
| fb-044 | 2 | extract.name | A store or retailer name is not a product name and must not be extracted as name. |
| fb-046 | 2 | extract.outOfStock | Product is not out of stock when the selected variant is available (for example, Add to Cart is active) and only an unselected variant is out of stock. |
| fb-047 | 2 | extract.description | Description content that exists only in an image must not be extracted as the description. |
| fb-048 | 2 | extract.outOfStock | A missing Add to Cart button or a quantity of 0, on its own, is not sufficient evidence to classify a product as out of stock. |
| fb-050 | 2 | extract.hasRichContent | A promotional image module (for example a profile sign-up banner) is not rich content. |
| fb-055 | 2 | extract.price | A price that belongs to a similar or related product must not be extracted as the main product price. |
| fb-059 | 2 | extract.price | A price must not be extracted when no price is visible on the rendered page, including when a value exists only in markdown or JSON data. |
| fb-060 | 2 | extract.netQuantity | A bare number without a supported measurement unit (such as g, kg, ml or L) must not be extracted as netQuantity and must remain null. |
| fb-073 | 2 | extract.video | A video section heading or manufacturer-provided content block is not sufficient evidence of a product video; extract only an actual playable product video. |
| fb-086 | 2 | extract.video | UI elements that are not product videos (for example a chat-widget play icon or an image thumbnail) must not be extracted as the product video. |
| fb-056 | 1 | extract.netQuantity | Values that differ only in separator (for example x versus /) with the same quantity and units are semantically equal and are not an anomaly. |
| fb-057 | 1 | extract.price | A price range displayed on the page is a valid price value when it is extracted as displayed. |
| fb-058 | 1 | extract.price | A price of 0.00 must not be extracted as the product price; return null. |
| fb-062 | 1 | extract.ingredients | Ingredients must not be inferred from a differently labeled field (for example Material) when no Ingredients or Composition label is present. |
| fb-066 | 1 | extract.instructions | Storage, serving and warning statements are not actionable usage instructions and must not be extracted as instructions. |
| fb-068 | 1 | feedback.commentCount | A comment count present only in JSON or other data must not be treated as confirmed when the review section is not visible on the loaded page. |
| fb-069 | 1 | extract.pricePerUnit | A single displayed price with no per-unit indicator is the main price and must not be classified as pricePerUnit. |
| fb-071 | 1 | extract.promotionText | Sales-volume or popularity indicators (for example 'bought in last month') are not promotions, discounts or offers and must not be extracted as promotionText. |
| fb-072 | 1 | extract.price | A price taken from a hidden element, not the main product's visible price slot, must not be extracted as the product price. |
| fb-079 | 1 | extract.bulletPoints | Points embedded in an image (for example a consumer notice) are not product bullet points and must not be extracted as bulletPoints. |
| fb-104 | 0 | extract.imageUrl | The anomaly detection is incorrectly expecting the Image URL to be in .jpg/.svg format. For this retailer, the extracted Image URL is expected to use the .res resource format, so the .res URL should be considered valid and the .jpg/.svg format should not be treated as the expected value. |
| fb-105 | 0 | extract.bulletPoints | This is a false positive. The bullet points are present in the page DOM, but they are inside a collapsed accordion element, so they are not visible in the screenshot. A bullet point that is hidden in the screenshot should not be treated as missing or mismatched when it is present in the DOM. The suggested bullet points are not valid bullet points: they contain no bullet symbol or list markup (such as •, -, or <li>) and read as a continuous description paragraph. Text that looks like a description should not be treated as bulletPoints. |
| fb-106 | 0 | extract.gtin | This is a false positive. The GTIN is not visible in the screenshot, but it is present in the page DOM, inside the script[type="application/ld+json"] structured data. The extracted GTIN comes from that structured data and is correct for the main product. A value that is missing from the screenshot but present in the page's structured data should not be flagged as an extraction error. |

## Pending manual review (not live)

These two were marked NEEDS MANUAL REVIEW in the sheet. They are inactive, so normal users never see them. Admins can see them, then edit and enable them or delete them.

| ID | Categories | Original text |
|---|---|---|
| fb-085 | extract.promotionText | Envío GRATIS a España a partir de 99€ |
| fb-087 | extract.outOfStock | Gather is not done. |
