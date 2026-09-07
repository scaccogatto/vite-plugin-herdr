<script setup lang="ts">
</script>

<template>
  <div>
    <h1>Bench</h1>

    <!-- Task 1: Label typo -->
    <section class="task-section">
      <p class="task-caption">Button label</p>
      <button id="task-label" class="btn btn-primary">Sumbit</button>
    </section>

    <!-- Task 2: Link href -->
    <section class="task-section">
      <p class="task-caption">Team link</p>
      <a id="task-link" href="/about">Meet the team</a>
    </section>

    <!-- Task 3: Accessible name -->
    <section class="task-section">
      <p class="task-caption">Close button</p>
      <button id="task-aria" class="icon-btn">×</button>
    </section>

    <!-- Task 4: Color contrast -->
    <section class="task-section">
      <p class="task-caption">Note styling</p>
      <p id="task-color" class="note">Important information should be clearly visible.</p>
    </section>

    <!-- Task 5: Placeholder copy -->
    <section class="task-section">
      <p class="task-caption">Billing section</p>
      <p id="task-copy">Lorem ipsum dolor sit amet.</p>
    </section>

    <!-- Task 6: Grid alignment -->
    <section class="task-section">
      <p class="task-caption">Card grid</p>
      <div id="task-grid" class="grid-cards">
        <div class="card">
          <h3>Card 1</h3>
          <p>First card content</p>
        </div>
        <div class="card">
          <h3>Card 2</h3>
          <p>Second card content</p>
        </div>
        <div id="task-align" class="card">
          <h3>Card 3</h3>
          <p>Third card content</p>
        </div>
      </div>
    </section>

    <!-- Task 7: Spacing -->
    <section class="task-section">
      <p class="task-caption">List spacing</p>
      <ul id="task-spacing" class="spaced-list">
        <li>Item 1</li>
        <li>Item 2</li>
        <li>Item 3</li>
      </ul>
    </section>

    <!-- Task 8: Overflow -->
    <section class="task-section">
      <p class="task-caption">Text overflow</p>
      <div id="task-overflow" class="overflow-box">
        verylongwordthatdoesnotbreakandoverflowsthecontainer
      </div>
    </section>

    <!-- Task 9: Font size -->
    <section class="task-section">
      <p class="task-caption">Section heading size</p>
      <h2 id="task-font">Billing</h2>
      <p>Billing information section content goes here.</p>
    </section>

    <!-- Task 10: Hover state -->
    <section class="task-section">
      <p class="task-caption">Button hover state</p>
      <button id="task-hover" class="btn">Archive</button>
    </section>
  </div>
</template>

<style scoped>
.task-section {
  padding: 2rem;
  margin-bottom: 2rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background-color: var(--bg-secondary);
}

.task-caption {
  margin: 0 0 1rem 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Task 4: Low contrast color */
.note {
  color: #999;
}

/* Task 6: Misaligned card */
#task-align {
  margin-top: 12px;
}

/* Task 7: Wrong spacing */
#task-spacing {
  gap: 2px;
  display: flex;
  flex-direction: column;
  list-style: none;
  padding: 0;
  margin: 0;
}

#task-spacing li {
  padding: 0.5rem;
}

/* Task 8: Overflow not handled */
#task-overflow {
  width: 200px;
  overflow: visible;
  border: 1px solid var(--border-color);
  padding: 1rem;
  word-break: normal;
}

/* Task 9: Tiny font size */
#task-font {
  font-size: 11px;
  margin: 0 0 0.5rem 0;
}

/* Grid for task 6 */
.grid-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
}

.grid-cards .card {
  background-color: var(--bg-primary);
  padding: 1.5rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
}

.grid-cards .card h3 {
  margin-top: 0;
  margin-bottom: 0.5rem;
}

.grid-cards .card p {
  margin: 0;
}

.spaced-list {
  display: flex;
  flex-direction: column;
}

.icon-btn {
  background: none;
  border: 1px solid var(--border-color);
  padding: 0.5rem;
  cursor: pointer;
  border-radius: 0.25rem;
  font-size: 1.25rem;
  line-height: 1;
  color: var(--text-primary);
}

.icon-btn:hover {
  background-color: var(--bg-secondary);
}
</style>
