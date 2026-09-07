<script setup lang="ts">
import { ref } from 'vue'

const userName = ref('Marco Boffo')
const userEmail = ref('chat@marcoboffo.me')
</script>

<template>
  <div>
    <h1>Settings</h1>

    <nav>
      <a href="#profile">Profile</a>
      <a href="#preferences">Preferences</a>
      <a href="#about">About</a>
    </nav>

    <form @submit.prevent>
      <label for="name">Name</label>
      <input id="name" v-model="userName" type="text" />

      <label for="email">Email</label>
      <input id="email" v-model="userEmail" type="email" />

      <button class="btn btn-primary">Save</button>
    </form>

    <div class="grid">
      <div class="card">
        <h3>Profile</h3>
        <p>Manage your personal information and account settings. Keep your profile up to date.</p>
      </div>

      <div class="card">
        <h3>Preferences</h3>
        <p>Customize your experience with theme, notifications, and privacy settings.</p>
      </div>

      <div class="card">
        <h3>Security</h3>
        <p>Secure your account with two-factor authentication and password management.</p>
      </div>
    </div>
  </div>
</template>
