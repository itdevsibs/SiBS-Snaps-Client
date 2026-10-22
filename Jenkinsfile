pipeline {
    agent any

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Prepare Docker Project Env') {
            steps {
                // Matches the SiBS HRIS pattern: Jenkins owns the environment
                // file. No .env needs to be committed to the Client repository.
                sh 'cp /var/jenkins_home/env-files/sibs-snaps-client.env "$WORKSPACE/.env"'
            }
        }

        stage('Build and Deploy') {
            steps {
                sh 'docker compose down || true'
                sh 'docker compose up --build -d'
            }
        }
    }

    post {
        always {
            sh 'rm -f "$WORKSPACE/.env"'
        }
    }
}
