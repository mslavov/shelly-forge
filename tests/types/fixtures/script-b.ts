function tick(): void {
  print('script b');
}

Timer.set(2000, true, tick);
