import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode
} from "libphonenumber-js/min";

type PhoneControls = {
  readonly form: HTMLFormElement;
  readonly input: HTMLInputElement;
  readonly select: HTMLSelectElement;
  readonly status: HTMLElement;
};

const countryCodes: ReadonlySet<string> = new Set(getCountries());

function isCountryCode(value: string): value is CountryCode {
  return countryCodes.has(value);
}

function selectedCountry(select: HTMLSelectElement): CountryCode {
  return isCountryCode(select.value) ? select.value : "US";
}

function formatUsNumber(digits: string): string {
  const groups = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)].filter(
    (group) => group.length > 0
  );
  const formatted = groups.join("-");
  const overflow = digits.slice(10);

  return overflow.length > 0 ? `${formatted} ${overflow}` : formatted;
}

function formatNationalNumber(digits: string, country: CountryCode): string {
  return country === "US"
    ? formatUsNumber(digits)
    : new AsYouType(country).input(digits);
}

function caretForDigitPosition(value: string, digitPosition: number): number {
  if (digitPosition === 0) return 0;

  let digitsSeen = 0;
  for (const [index, character] of Array.from(value).entries()) {
    if (/\d/.test(character)) digitsSeen += 1;
    if (digitsSeen === digitPosition) return index + 1;
  }

  return value.length;
}

function formatCurrentValue(controls: PhoneControls): void {
  const { input, select } = controls;
  if (input.value.trimStart().startsWith("+")) return;
  if (!/^[0-9() .-]*$/.test(input.value)) return;

  const caret = input.selectionStart ?? input.value.length;
  const digitPosition = input.value.slice(0, caret).replace(/\D/g, "").length;
  const digits = input.value.replace(/\D/g, "");
  const formatted = formatNationalNumber(digits, selectedCountry(select));
  const nextCaret = caretForDigitPosition(formatted, digitPosition);

  input.value = formatted;
  input.setSelectionRange(nextCaret, nextCaret);
}

function announceCountry(controls: PhoneControls): void {
  const label = controls.select.selectedOptions.item(0)?.textContent?.trim();
  controls.status.textContent = label ? `Country changed to ${label}.` : "";
}

function reconcileInternational(
  controls: PhoneControls,
  internationalValue: string
): boolean {
  const parsed = parsePhoneNumberFromString(internationalValue.trim(), {
    extract: false
  });

  if (!parsed?.country || !parsed.isPossible()) return false;
  if (parsed.number.replace(/\D/g, "") !== internationalValue.replace(/\D/g, "")) {
    return false;
  }

  const currentCountry = selectedCountry(controls.select);
  const currentCallingCode = getCountryCallingCode(currentCountry);
  const nextCountry =
    parsed.countryCallingCode === "1"
      ? currentCallingCode === "1"
        ? currentCountry
        : "US"
      : parsed.country;
  const countryChanged = currentCountry !== nextCountry;

  controls.select.value = nextCountry;
  controls.input.value =
    nextCountry === "US"
      ? formatUsNumber(parsed.nationalNumber)
      : parsed.formatNational();
  controls.input.setSelectionRange(
    controls.input.value.length,
    controls.input.value.length
  );
  controls.status.textContent = "";
  if (countryChanged) announceCountry(controls);

  return true;
}

function handlePaste(controls: PhoneControls, event: ClipboardEvent): void {
  const pastedText = event.clipboardData?.getData("text/plain");
  if (pastedText === undefined) return;

  event.preventDefault();
  const start = controls.input.selectionStart ?? controls.input.value.length;
  const end = controls.input.selectionEnd ?? start;
  controls.input.value = `${controls.input.value.slice(0, start)}${pastedText}${controls.input.value.slice(end)}`;
  const pastedEnd = start + pastedText.length;
  controls.input.setSelectionRange(pastedEnd, pastedEnd);
  controls.status.textContent = "";

  if (controls.input.value.trimStart().startsWith("+")) {
    reconcileInternational(controls, controls.input.value);
    return;
  }

  formatCurrentValue(controls);
}

function setupPhoneField(field: HTMLElement): void {
  const input = field.querySelector<HTMLInputElement>("[data-phone-input]");
  const select = field.querySelector<HTMLSelectElement>("[data-phone-country]");
  const status = field.querySelector<HTMLElement>("[data-phone-status]");
  const form = field.closest("form");

  if (!input || !select || !status || !(form instanceof HTMLFormElement)) return;
  const controls: PhoneControls = { form, input, select, status };

  input.addEventListener("input", () => {
    status.textContent = "";
    formatCurrentValue(controls);
  });
  input.addEventListener("change", () => {
    if (!reconcileInternational(controls, input.value)) formatCurrentValue(controls);
  });
  input.addEventListener("paste", (event) => handlePaste(controls, event));
  select.addEventListener("change", () => {
    status.textContent = "";
    formatCurrentValue(controls);
  });
  form.addEventListener("formdata", (event) => {
    const phone = input.value.trim();
    if (phone.length === 0 || phone.startsWith("+")) {
      event.formData.set("phone", phone);
      return;
    }

    const country = selectedCountry(select);
    const parsed = parsePhoneNumberFromString(phone, country);
    const fallback = `+${getCountryCallingCode(country)} ${phone}`;

    if (!parsed?.isPossible()) {
      event.formData.set("phone", fallback);
      return;
    }

    event.formData.set(
      "phone",
      country === "US"
        ? `+1 ${formatUsNumber(parsed.nationalNumber)}`
        : parsed.formatInternational()
    );
  });
  form.addEventListener("reset", () => {
    queueMicrotask(() => {
      select.value = "US";
      input.value = "";
      status.textContent = "";
    });
  });

  const restoreValue = () => {
    if (!reconcileInternational(controls, input.value)) formatCurrentValue(controls);
  };
  restoreValue();
  window.addEventListener("pageshow", restoreValue);
}

document
  .querySelectorAll<HTMLElement>("[data-phone-field]")
  .forEach(setupPhoneField);
