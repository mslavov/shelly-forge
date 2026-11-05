function tick(): void {
  print('script a');
}

Timer.set(1000, true, tick);
