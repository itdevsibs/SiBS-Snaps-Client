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
