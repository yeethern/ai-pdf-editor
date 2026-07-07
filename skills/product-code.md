# Product Code Transformation Skill

## Metadata
- **ID**: `product-code-skill`
- **Name**: Product Code Transformation
- **Version**: `1.0.0`
- **Description**: Transforms ECO-prefixed product codes to TC-prefixed codes with digit shifting.
  First 3 digits after the prefix are shifted by +2; product info segments are preserved.

## Rules

### Rule 1: ECO to TC (Dotted Format)
- **ID**: `eco-to-tc-dotted`
- **Description**: Replace ECO prefix with TC, shift first 3 digits by +2, preserve rest
- **Pattern**: `ECO(\d{3})\.(\d{3})\.(\d{3})`
- **Replacement**: `TC$1.$2.$3`
- **Digit Shift**: `+2`
- **Shift Groups**: `[0]`
- **Priority**: `100`
- **Example**: `ECO205.096.004` → `TC427.096.004`

### Rule 2: ECO to TC (Joined/Dashed Format)
- **ID**: `eco-to-tc-joined`
- **Description**: Replace ECO prefix in dashed format, shift first 3 digits by +2
- **Pattern**: `(\w+-)?ECO(\d{3})(\d{6})`
- **Replacement**: `$1TC$2$3`
- **Digit Shift**: `+2`
- **Shift Groups**: `[1]`
- **Priority**: `90`
- **Example**: `HDL-ECO205096004` → `HDL-TC427096004`

### Rule 3: Standalone ECO Code
- **ID**: `eco-to-tc-standalone`
- **Description**: Replace standalone ECO-prefixed codes
- **Pattern**: `\bECO(\d{3})(\d{6})\b`
- **Replacement**: `TC$1$2`
- **Digit Shift**: `+2`
- **Shift Groups**: `[0]`
- **Priority**: `80`
- **Example**: `ECO205096004` → `TC427096004`

## Transform Logic

### Digit Shift (Caesar +2)
Each digit in the shift groups is transformed: `0→2, 1→3, 2→4, 3→5, 4→6, 5→7, 6→8, 7→9, 8→0, 9→1`

### Preserved Segments
Non-shifted digit groups remain unchanged (e.g., product info / measurement segments).

## Exceptions
- Measurements/specifications (e.g., `3/4" (19MM)`) are NOT transformed
- Already-transformed codes are skipped
- Standalone numbers without ECO prefix are not affected

## Test Cases
1. `ECO205.096.004 HANDLE` → `TC427.096.004 HANDLE`
2. `HDL-ECO205096004` → `HDL-TC427096004`
3. `ECO205096004` → `TC427096004`
4. `T3558 3/4" (19MM) ALUMINIUM PROFILE` → unchanged
5. `HANDLE WITHOUT TRIM` → unchanged
