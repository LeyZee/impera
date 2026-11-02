import { configure } from '@testing-library/dom';

/*
 * How long `findBy…` and `waitFor` wait before they fail. The library's 1 s is spent by a loaded machine (the pre-push
 * runs the web and the API suites side by side on a laptop) before the screen has rendered, and a right screen fails.
 * Waiting longer changes no assertion: a screen that never shows what is asked still fails, only later.
 */
configure({ asyncUtilTimeout: 5_000 });
