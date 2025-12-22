import { getTestData } from '../support/e2e';

describe('Loam Logger Smoke Test - Full User Flow', () => {
  const testData = getTestData();
  const testEmail = testData.email;
  const testPassword = testData.password;

  afterEach(function() {
    // If test failed and we're logged in, delete the account
    if (this.currentTest?.state === 'failed') {
      cy.visit('/settings', { failOnStatusCode: false });
      cy.contains('button', 'Delete Account').click({ force: true });
      cy.contains('button', 'Delete Account').last().click({ force: true });
    }
  });

  it('should complete full user lifecycle', () => {
    // ============= SIGNUP =============
    cy.visit('/');
    cy.contains('button', 'Log In').click();
    cy.url().should('include', '/login');

    // Switch to signup mode
    cy.contains('button', "Sign Up").click();

    // Fill signup form
    cy.get('input[type="email"]').type(testEmail);
    cy.get('input[type="password"]').first().type(testPassword);
    cy.get('input[type="password"]').last().type(testPassword);
    cy.get('input[placeholder*="Name"]').type(testData.name);

    // Submit signup
    cy.contains('button', 'Create Account').click();

    // Should redirect to onboarding
    cy.url().should('include', '/onboarding');

    // ============= ONBOARDING - STEP 1: AGE =============
    cy.contains('h2', /How old are you/).should('be.visible');
    cy.contains(testData.name.split(' ')[0]).should('be.visible'); // Check personalized greeting
    cy.get('input[type="number"]').clear().type(testData.age);
    cy.contains('button', 'Continue').click();

    // ============= ONBOARDING - STEP 2: LOCATION =============
    cy.contains('h2', 'Where are you located?').should('be.visible');
    cy.get('input[placeholder*="Bellingham"]').type(testData.location);
    cy.contains('button', 'Continue').click();

    // ============= ONBOARDING - STEP 3: BIKE =============
    cy.contains('h2', 'Tell us about your bike').should('be.visible');
    cy.get('input[placeholder="Propain"]').type(testData.bike.make);
    cy.get('input[placeholder="Tyee"]').type(testData.bike.model);
    cy.get('input[type="number"]').first().clear().type(testData.bike.year);
    cy.contains('button', 'Continue').click();

    // ============= ONBOARDING - STEP 4: COMPONENTS =============
    cy.contains('h2', 'What components does it have?').should('be.visible');
    cy.get('input[placeholder*="RockShox"]').type(testData.bike.fork);
    cy.get('input[placeholder*="Fox"]').type(testData.bike.rearShock);
    cy.get('input[placeholder*="Industry Nine"]').type(testData.bike.wheels);
    cy.get('input[placeholder*="PNW"]').type(testData.bike.dropperPost);
    cy.contains('button', 'Complete Setup').click();

    // Should redirect to dashboard
    cy.url().should('include', '/dashboard');

    // ============= DASHBOARD: VALIDATE NAME =============
    cy.contains(testData.name.split(' ')[0]).should('be.visible');

    // ============= MY BIKES: VALIDATE ONBOARDED BIKE =============
    cy.contains('a', 'My Bikes').click();
    cy.url().should('include', '/gear');
    cy.contains(testData.bike.make).should('be.visible');
    cy.contains(testData.bike.model).should('be.visible');
    cy.contains(testData.bike.year).should('be.visible');
    cy.contains('Rockshox Zeb Ultimate', { matchCase: false }).should('be.visible'); // Fork
    cy.contains('Rockshox Vivid Ultimate', { matchCase: false }).should('be.visible'); // Shock (parsed)
    cy.contains('Project 321 NOBL', { matchCase: false }).should('be.visible'); // Wheels
    cy.contains('Yoke 200mm', { matchCase: false }).should('be.visible'); // Dropper (parsed)

    // ============= ADD NEW RIDE =============
    cy.contains('a', 'Rides').click();
    cy.url().should('include', '/rides');

    // Fill in ride details
    cy.get('input[placeholder*="Copper Harbor"]').clear().type(testData.ride.trail);
    cy.get('input[type="number"][min="0"][step="0.1"]').first().type('{selectAll}').type(testData.ride.distance);
    cy.get('input[type="number"][min="0"][step="1"]').first().type('{selectAll}').type(testData.ride.elevation);
    cy.get('input[type="number"][min="0"]').eq(0).type('{selectAll}').type(testData.ride.duration.split(':')[0]); // Hours
    cy.get('input[type="number"][min="0"][max="59"]').type('{selectAll}').type(testData.ride.duration.split(':')[1]); // Minutes

    // Submit ride
    cy.contains('button', 'Save Ride').click();

    // Wait for ride to be saved and displayed in the list
    cy.contains(testData.ride.trail).should('be.visible');

    // Should see ride on dashboard
    cy.contains('a', 'Dashboard').click();
    cy.url().should('include', '/dashboard');
    cy.contains(testData.ride.trail).should('be.visible');

    // ============= VALIDATE BIKE HOURS UPDATED =============
   
    cy.contains(testData.bike.model).parent().should('contain', '2.5h'); // 2:30 duration

    // ============= ADD NEW BIKE FROM MANAGE BIKES PAGE =============
    cy.contains('a', 'My Bikes').click();
    cy.url().should('include', '/gear');
    cy.contains('button', 'Add Bike').click();

    // Wait for modal to be fully visible
    cy.get('input[placeholder="e.g. Transition"]').should('be.visible').type(testData.newBike.make);
    cy.get('input[placeholder="Smuggler"]').should('be.visible').type(testData.newBike.model);
    cy.contains('span', 'Year').parent().find('input[type="number"]').first().type('{selectAll}').type(testData.newBike.year);

    // Scroll to submit button and click it
    cy.contains('button', 'Create Bike').last().scrollIntoView().should('be.visible').click();

    // Should see new bike in list
    cy.contains(testData.newBike.make).should('be.visible');
    cy.contains(testData.newBike.model).should('be.visible');

    // ============= LOGOUT =============
    cy.contains('a', 'Settings').click();
    cy.url().should('include', '/settings');
    cy.contains('button', 'Log Out').click();

    // Should be redirected to login
    cy.url().should('include', '/login');

    // ============= VALIDATE UNABLE TO ACCESS APP WITHOUT LOGIN =============
    cy.visit('/dashboard');
    cy.url().should('include', '/login'); // Should redirect to login

    // ============= LOGIN AGAIN =============
    cy.get('input[type="email"]').type(testEmail);
    cy.get('input[type="password"]').type(testPassword);
    cy.contains('button', 'Log In').click();

    // Should be on dashboard (onboarding already complete)
    cy.url().should('include', '/dashboard');
    cy.contains(testData.name).should('be.visible');

    // ============= DELETE ACCOUNT =============
    cy.contains('a', 'Settings').click();
    cy.contains('button', 'Delete Account').click();

    // Confirm deletion
    cy.contains('button', 'Delete Account').last().click();

    // Should be redirected to login with success message
    cy.url().should('include', '/login');
    cy.contains(/account.*deleted/i).should('be.visible');

    // ============= VALIDATE ACCOUNT DELETED - TRY TO LOGIN =============
    cy.get('input[type="email"]').type(testEmail);
    cy.get('input[type="password"]').type(testPassword);
    cy.contains('button', 'Log In').click();

    // Should show error or redirect to login (account no longer exists)
    cy.url().should('include', '/login');
    cy.contains(/invalid|not found|incorrect/i).should('be.visible');
  });
});
