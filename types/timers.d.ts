/**
 * The HTML standard has clearTimeout take any value and do nothing with one that names no timer,
 * null included; the code holds a timer as null while there is none and clears it regardless.
 */
declare function clearTimeout(id: number | null | undefined): void;
