# Bulk upload (Excel + images) - Restaurant app and Seller app - Flutter guide

Base URL `https://sooperbuddy.in/api/v1`. Backend and web panels are live. Header on every call: `Authorization: Bearer <token>` (restaurant token for restaurant APIs, seller token for seller APIs).

## 1. Summary

| Panel | What | Template (GET) | Upload (POST, multipart) |
|---|---|---|---|
| Restaurant | Food items | `/food/restaurant/foods/bulk-template` | `/food/restaurant/foods/bulk-upload` |
| Restaurant | Add-ons | `/food/restaurant/addons/bulk-template` | `/food/restaurant/addons/bulk-upload` |
| Seller | Marketplace products | `/seller/products/bulk-template` | `/seller/products/bulk-upload` |

(Check the exact prefix the app already uses for the restaurant / seller APIs, e.g. the one used for `GET /food/restaurant/addons` and `GET /seller/categories/tree`. Same prefix + the path above.)

Flow is identical everywhere: **download template -> user fills it in Excel -> app picks the .xlsx + the images it mentions -> upload -> show per-row result.**

## 2. Template download
`GET .../bulk-template` returns the **.xlsx file bytes** (not JSON). Save it to the phone's Downloads / share sheet (`food-bulk-upload-template.xlsx`, `addon-bulk-upload-template.xlsx`, `product-bulk-upload-template.xlsx`) so the user can edit it on a PC/Excel. It contains an example row and an "Instructions" sheet. Send the Bearer header while downloading (use Dio `ResponseType.bytes`).

## 3. Upload request
`POST` as `multipart/form-data`, two fields:

| Field | Type | Notes |
|---|---|---|
| `file` | 1 file | the filled `.xlsx` (first sheet is read) |
| `images` | many files (repeat the field name) | every image the sheet refers to by file name |

Limits: **5 MB per file, max 300 files in total** (the Excel counts as one). If the user selects more / bigger files, block it in the app with a message.
Dart (Dio):
```dart
final form = FormData();
form.files.add(MapEntry('file', await MultipartFile.fromFile(xlsxPath, filename: 'items.xlsx')));
for (final p in imagePaths) {
  form.files.add(MapEntry('images', await MultipartFile.fromFile(p, filename: p.split('/').last))); // keep ORIGINAL file name
}
final r = await dio.post(url, data: form);
```
Important: the **file name of each picked image must stay unchanged** - the sheet matches images by name (case-insensitive, spaces/underscores ignored, e.g. `Paneer_Tikka.JPG` == `paneertikka.jpg`).

## 4. Response (same shape for all three)
HTTP `200`:
```json
{ "success": true, "message": "Bulk upload processed",
  "data": { "totalRows": 10,
    "created": [ { "row": 2, "id": "6a7...", "name": "Paneer Tikka" } ],
    "failed":  [ { "row": 5, "name": "Dal Fry", "reason": "Image \"dal.jpg\" not found in uploaded images" } ] } }
```
- Seller responses wrap the payload in `result` instead of `data` (like other seller APIs). Read `res.data['data'] ?? res.data['result']`.
- A row is saved independently: some rows can succeed while others fail. `row` is the Excel row number (header = row 1, first data row = 2).
- Request-level errors (`400`): `Excel file is required`, `No data rows found in the excel file`; also `401/403` for a wrong token. Show `message`.

## 5. Excel columns

### 5a. Restaurant - Food items
Headers (row 1, order/case/spaces don't matter): `Food Name, Description, Price, Other Price, Food Type, Variants, Category Name, Image, Tags, Is Recommended`

| Column | Rule |
|---|---|
| Food Name | required |
| Price | required (> 0) **unless** Variants is filled |
| Variants | optional, `Name:Price:Unit;Name:Price:Unit` e.g. `Small:149:piece;Medium:199:piece`. Entries without name or price > 0 are dropped. When present, the item price = variants |
| Other Price | optional (strike-through/MRP price) |
| Food Type | `Veg` or `Non-Veg` (anything containing "non" = Non-Veg, else Veg) |
| Category Name | optional; must exactly (case-insensitive) match an **approved** category of this restaurant / global category. Unknown / unapproved / veg-non-veg mismatch -> row fails (`Category not found for this restaurant`, `This category is awaiting admin approval`). Pure-veg restaurants can only use Veg categories |
| Image | file name of an uploaded image (required - row fails if the name is not among `images`) |
| Tags | comma separated |
| Is Recommended | `yes` / `no` (starts with y = true) |

Created foods go to **admin approval** (`approvalStatus: pending`); they are not visible to customers until the admin approves. Show a note: "Items sent for admin approval".

### 5b. Restaurant - Add-ons
Headers: `Addon Name, Description, Price, Food Type, Image`. Name required; Price >= 0; Image = uploaded file name. A name already existing for the restaurant -> row fails `Add-on already exists`.

### 5c. Seller - Products
Headers: `Product Name, Description, Brand, Header Category, Category, Subcategory, Tags, Price, Sale Price, Stock, Variant Label, Images, Variants, Variant Images`

| Column | Rule |
|---|---|
| Product Name | required |
| Header Category | required; must exactly match an existing active header category. `Category` / `Subcategory` optional but must exist under their parent. Errors: `Header category "x" not found`, `Category "x" not found under "y"`. Load names for a help screen from `GET /seller/categories/tree` |
| Single variant product | fill `Price` (> 0), optional `Sale Price`, `Stock`, `Variant Label` (default "Default") and `Images` (comma separated file names) |
| Multi-variant product | fill `Variants` = `Name:Price:SalePrice:Stock;...`, e.g. `Small:28:25:100;Large:55:50:60` (SalePrice may be blank: `Small:100::20`), **max 5 variants**, and `Variant Images` = one group per variant separated by `\|`, files in a group separated by `,`, same order as Variants: `small1.jpg,small2.jpg\|large1.jpg`. Max 3 images per variant |
| Images | every variant needs at least 1 matching uploaded image, else row fails `Variant "x": no matching image found (checked: ...)` |
| Brand, Tags, Description | optional (tags comma separated) |

Products are created with status `active` through the normal "add product" logic (same rules as adding one product manually).

## 6. Screens (mirror the web panel)
1. **Bulk upload screen** (Menu -> "Bulk upload" for restaurant, with a Food items / Add-ons toggle; Products -> "Bulk upload" for seller).
2. Step 1: "Download template" button (section 2) + short instruction text (file names must match, 5 MB/file, 300 files max).
3. Step 2: "Select Excel (.xlsx)" (file picker, xlsx only) and "Select images" (multi-image picker). Show counts ("1 file, 24 images") and let the user remove them. Keep original file names.
4. Step 3: **Upload** button (disabled until Excel is chosen). Show a progress bar / loader (can take a while for many rows; use a long timeout, e.g. 5 min).
5. Result: summary "8 added, 2 failed of 10 rows". List failed rows (row no., name, reason) with a **copy / share** option so the user can fix the Excel and upload again (only the failed rows need re-upload; successful ones are already saved - re-uploading them creates duplicates, show this warning).
6. After success refresh the menu / product list.

## 7. QA checklist
1. Template downloads and opens in Excel (all 3 types).
2. Valid file with 3 rows + images -> `created` has 3, items appear (food items show as pending approval).
3. Image name typo -> only that row fails with a clear reason.
4. Unknown category -> that row fails, others pass.
5. No Excel selected -> button disabled; empty sheet -> `No data rows found in the excel file` shown.
6. File > 5 MB or > 300 files -> blocked / server error shown without crashing.
7. Variants format works (food `Small:149:piece;...`, product `Small:28:25:100;...`), product with 6 variants fails with "Maximum 5 variants allowed per product".
8. Wrong role token (seller token on restaurant API) -> 401/403 message.
